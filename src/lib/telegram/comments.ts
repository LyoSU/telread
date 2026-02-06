import { getTelegramClient } from './client'
import { MAX_COMMENT_LENGTH } from '@/config/constants'
import { getTime } from '@/lib/utils'
import type { Message as TgMessage } from '@mtcute/web'
import type { MessageMedia, MessageEntity, MessageForward } from './messages'
import { mapMessage } from './messages'
import { isChannelInvalid, isMessageNotFound, isFloodWait, getErrorMessage } from './errors'
import Long from 'long'

// ============================================================================
// Types
// ============================================================================

export interface CommentAuthor {
  id: number
  name: string
  photo?: string
}

export interface CommentReaction {
  emoji: string
  count: number
}

export interface Comment {
  id: number
  text: string
  author: CommentAuthor
  date: Date
  replyToId?: number
  /** Author of the comment being replied to (resolved from replyToId) */
  replyToAuthor?: { name: string }
  replies?: Comment[]
  reactions?: CommentReaction[]
  media?: MessageMedia
  entities?: MessageEntity[]
  forward?: MessageForward
}

export interface CommentThread {
  totalCount: number
  comments: Comment[]
  discussionChatId?: number
  discussionMessageId?: number
  hasMore: boolean
  nextOffsetId?: number
  /** Discussion was deleted — commenting is not available */
  disabled?: boolean
}

export class CommentError extends Error {
  constructor(
    message: string,
    public readonly code: 'DISABLED' | 'NOT_FOUND' | 'NETWORK' | 'VALIDATION' | 'UNKNOWN'
  ) {
    super(message)
    this.name = 'CommentError'
  }
}

// ============================================================================
// TL Response Types (minimal typing for Telegram API responses)
// ============================================================================

interface TLUser {
  id: number
  firstName?: string
  lastName?: string
  username?: string
  photo?: { _: string }
}

interface TLChat {
  id: number
  title?: string
  _: string
}

interface TLMessageReplyHeader {
  replyToMsgId?: number
  replyToTopId?: number
}

interface TLMedia {
  _: string
  // Photo
  photo?: { sizes?: Array<{ w?: number; h?: number }> }
  // Video/Document
  document?: {
    mimeType?: string
    attributes?: Array<{
      _: string
      w?: number
      h?: number
      duration?: number
      fileName?: string
      title?: string
      performer?: string
      waveform?: Uint8Array
    }>
  }
  // Geo
  geo?: { lat?: number; long?: number }
  // Venue
  title?: string
  address?: string
  // Poll
  poll?: { question?: { text?: string }; answers?: Array<{ text?: { text?: string } }> }
  results?: { results?: Array<{ option?: Uint8Array; voters?: number }> }
  // Contact
  phoneNumber?: string
  firstName?: string
  lastName?: string
  userId?: number
  // Dice
  emoticon?: string
  value?: number
  // Webpage
  webpage?: { url?: string; title?: string; description?: string; siteName?: string }
}

interface TLMessage {
  _: string
  id: number
  message?: string
  date: number
  fromId?: { _: string; userId?: number; channelId?: number }
  replyTo?: TLMessageReplyHeader
  media?: TLMedia
  reactions?: { results?: Array<{ reaction: { emoticon?: string }; count: number }> }
  fwdFrom?: {
    date?: number
    fromId?: { _: string; userId?: number; channelId?: number }
    fromName?: string
    channelPost?: number
    postAuthor?: string
  }
  entities?: Array<{
    _: string
    offset: number
    length: number
    url?: string
    language?: string
    userId?: number
    documentId?: bigint
  }>
}

interface TLMessagesResponse {
  _: string
  count?: number
  messages?: TLMessage[]
  users?: TLUser[]
  chats?: TLChat[]
}

// ============================================================================
// Fetch Comments
// ============================================================================

export interface FetchCommentsOptions {
  limit?: number
  offsetId?: number
}

/**
 * Fetch comments for a channel post using messages.getReplies API
 * @throws {CommentError} When comments cannot be fetched
 */
export async function fetchComments(
  channelId: number,
  messageId: number,
  options?: FetchCommentsOptions
): Promise<CommentThread> {
  const client = getTelegramClient()
  const limit = Math.min(options?.limit ?? 50, 100) // Cap at 100

  try {
    // Resolve the peer to get proper input peer with access hash
    const peer = await client.resolvePeer(channelId)

    // Use messages.getReplies - the correct Telegram API for channel post comments
    const result = (await client.call({
      _: 'messages.getReplies',
      peer,
      msgId: messageId,
      offsetId: options?.offsetId ?? 0,
      offsetDate: 0,
      addOffset: 0,
      limit,
      maxId: 0,
      minId: 0,
      hash: Long.ZERO,
    })) as TLMessagesResponse

    return processCommentsResponse(result, messageId, limit)
  } catch (error) {
    // Channel itself is invalid/forbidden — no point trying fallback
    if (isChannelInvalid(error)) {
      throw new CommentError('Channel not found or access denied', 'NOT_FOUND')
    }

    if (isFloodWait(error)) {
      throw new CommentError(getErrorMessage(error), 'NETWORK')
    }

    // For MSG_ID_INVALID and other errors, try fallback
    // Pass primaryFailed=true so fallback can mark as disabled if it also finds nothing
    return fetchCommentsViaDiscussion(channelId, messageId, limit, true)
  }
}

/**
 * Process the TL response into CommentThread
 */
function processCommentsResponse(
  result: TLMessagesResponse,
  _messageId: number,
  requestedLimit: number
): CommentThread {
  const comments: Comment[] = []
  let discussionChatId: number | undefined
  let discussionMessageId: number | undefined
  let totalCount = 0

  const validTypes = ['messages.channelMessages', 'messages.messages', 'messages.messagesSlice']

  if (validTypes.includes(result._)) {
    totalCount = result.count ?? result.messages?.length ?? 0

    // Build lookup maps for author resolution
    const users = new Map<number, TLUser>()
    const chats = new Map<number, TLChat>()

    if (result.users) {
      for (const user of result.users) {
        users.set(user.id, user)
      }
    }

    if (result.chats) {
      for (const chat of result.chats) {
        chats.set(chat.id, chat)
        // Get discussion chat ID (usually the first supergroup/channel)
        // Convert to marked ID format: -1000000000000 - rawId
        if (!discussionChatId && (chat._ === 'channel' || chat._ === 'channelForbidden')) {
          // Channels/supergroups use marked ID format
          discussionChatId = -1000000000000 - chat.id
        } else if (!discussionChatId && (chat._ === 'chat' || chat._ === 'chatForbidden')) {
          // Regular chats use negative ID
          discussionChatId = -chat.id
        }
      }
    }

    // Map messages to comments
    if (result.messages) {
      for (const msg of result.messages) {
        // Extract discussionMessageId from first message's replyToTopId
        // This is the ID of the discussion message (thread root) in the discussion group
        if (!discussionMessageId && msg.replyTo?.replyToTopId) {
          discussionMessageId = msg.replyTo.replyToTopId
        }
        
        const comment = mapTLMessageToComment(msg, users, chats)
        if (comment) {
          comments.push(comment)
        }
      }
    }
  }

  const threadedComments = buildCommentTree(comments)
  const hasMore = comments.length >= requestedLimit && comments.length < totalCount
  const nextOffsetId = hasMore && comments.length > 0 ? comments[comments.length - 1].id : undefined

  return {
    totalCount,
    comments: threadedComments,
    discussionChatId,
    discussionMessageId,
    hasMore,
    nextOffsetId,
  }
}

/**
 * Fallback method using getDiscussionMessage and iterHistory
 */
async function fetchCommentsViaDiscussion(
  channelId: number,
  messageId: number,
  limit: number,
  primaryFailed = false
): Promise<CommentThread> {
  const client = getTelegramClient()

  try {
    const discussion = await client.getDiscussionMessage({
      chatId: channelId,
      message: messageId,
    })

    if (!discussion) {
      return { ...createEmptyThread(), disabled: true }
    }

    const discussionAny = discussion as TgMessage & { chat?: { id: number }; replies?: { count: number } }
    const chatId = discussionAny.chat?.id

    if (!chatId) {
      return { ...createEmptyThread(), disabled: primaryFailed }
    }

    const comments: Comment[] = []
    let messagesChecked = 0
    const maxMessagesToCheck = limit * 3 // Safety limit

    // Iterate through discussion group history
    for await (const msg of client.iterHistory(chatId, { limit: maxMessagesToCheck })) {
      messagesChecked++
      const msgAny = msg as TgMessage & { replyToMessageId?: number; replyTo?: { replyToMsgId?: number } }

      // Check if this message is a reply to the discussion message
      const isReply =
        msgAny.replyToMessageId === discussion.id ||
        msgAny.replyTo?.replyToMsgId === discussion.id

      if (isReply) {
        const mapped = mapHighLevelMessage(msg, discussion.id)
        if (mapped) {
          comments.push(mapped)
          if (comments.length >= limit) break
        }
      }

      if (messagesChecked >= maxMessagesToCheck) break
    }

    const threadedComments = buildCommentTree(comments)
    const totalCount = discussionAny.replies?.count ?? comments.length

    // Primary API failed AND fallback found 0 comments → discussion thread is broken
    if (primaryFailed && comments.length === 0) {
      return { ...createEmptyThread(), disabled: true }
    }

    return {
      totalCount,
      comments: threadedComments,
      discussionChatId: chatId,
      discussionMessageId: discussion.id,
      hasMore: comments.length >= limit,
      nextOffsetId: comments.length > 0 ? comments[comments.length - 1].id : undefined,
    }
  } catch (error) {
    // Discussion thread deleted or inaccessible — show disabled state, not error
    if (isMessageNotFound(error) || isChannelInvalid(error)) {
      return { ...createEmptyThread(), disabled: true }
    }
    throw new CommentError('Failed to load comments', 'NETWORK')
  }
}

// ============================================================================
// Send Comment
// ============================================================================

/**
 * Send a comment on a channel post
 * @throws {CommentError} When comment cannot be sent
 */
export async function sendComment(
  channelId: number,
  messageId: number,
  text: string,
  replyToCommentId?: number
): Promise<Comment> {
  // Input validation
  const trimmedText = text.trim()

  if (!trimmedText) {
    throw new CommentError('Comment cannot be empty', 'VALIDATION')
  }

  if (trimmedText.length > MAX_COMMENT_LENGTH) {
    throw new CommentError(
      `Comment exceeds maximum length of ${MAX_COMMENT_LENGTH} characters`,
      'VALIDATION'
    )
  }

  const client = getTelegramClient()

  try {
    const discussion = await client.getDiscussionMessage({
      chatId: channelId,
      message: messageId,
    })

    if (!discussion) {
      throw new CommentError('Comments are disabled for this post', 'DISABLED')
    }

    const discussionAny = discussion as TgMessage & { chat?: { id: number } }
    const chatId = discussionAny.chat?.id

    if (!chatId) {
      throw new CommentError('Could not find discussion chat', 'NOT_FOUND')
    }

    const sent = await client.sendText(chatId, trimmedText, {
      replyTo: replyToCommentId ?? discussion.id,
    })

    return {
      id: sent.id,
      text: sent.text ?? trimmedText,
      author: {
        id: sent.sender?.id ?? 0,
        name: sent.sender?.displayName ?? 'You',
      },
      date: sent.date,
      replyToId: replyToCommentId,
      replies: [],
    }
  } catch (error) {
    if (error instanceof CommentError) {
      throw error
    }

    if (import.meta.env.DEV) {
      console.error('Failed to send comment:', error)
    }

    // Use typed error checks from errors.ts
    if (isFloodWait(error)) {
      throw new CommentError(getErrorMessage(error), 'NETWORK')
    }

    throw new CommentError('Failed to send comment', 'UNKNOWN')
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function createEmptyThread(): CommentThread {
  return {
    totalCount: 0,
    comments: [],
    hasMore: false,
  }
}

/**
 * Map TL message to Comment (for messages.getReplies response)
 */
function mapTLMessageToComment(
  msg: TLMessage,
  users: Map<number, TLUser>,
  chats: Map<number, TLChat>
): Comment | null {
  if (!msg || msg._ === 'messageEmpty' || msg._ === 'messageService') {
    return null
  }

  const text = msg.message ?? ''
  if (!text && !msg.media) {
    return null
  }

  // Resolve author
  const author = resolveAuthor(msg.fromId, users, chats)

  // Get reply-to ID
  // In discussion groups:
  // - replyToTopId = ID of discussion message (thread root)
  // - replyToMsgId = ID of message being replied to
  // If replyToMsgId === replyToTopId, it's a root comment (not a reply to another comment)
  const replyToMsgId = msg.replyTo?.replyToMsgId
  const replyToTopId = msg.replyTo?.replyToTopId
  const replyToId = (replyToMsgId && replyToTopId && replyToMsgId !== replyToTopId)
    ? replyToMsgId
    : undefined

  // Map reactions if present
  const reactions = mapReactions(msg.reactions)

  // Map media if present
  const media = mapTLMedia(msg.media)

  // Map entities if present
  const entities = mapTLEntities(msg.entities)

  // Map forward info if present
  const forward = mapTLForward(msg.fwdFrom, users, chats)

  return {
    id: msg.id,
    text,
    author,
    date: new Date(msg.date * 1000),
    replyToId,
    reactions,
    media,
    entities,
    forward,
  }
}

/**
 * Map TL media to MessageMedia
 */
function mapTLMedia(media: TLMedia | undefined): MessageMedia | undefined {
  if (!media) return undefined

  const type = media._

  // Photo
  if (type === 'messageMediaPhoto' && media.photo) {
    const sizes = media.photo.sizes ?? []
    const largest = sizes[sizes.length - 1]
    return {
      type: 'photo',
      width: largest?.w,
      height: largest?.h,
    }
  }

  // Document (video, audio, voice, sticker, animation, file)
  if (type === 'messageMediaDocument' && media.document) {
    const doc = media.document
    const attrs = doc.attributes ?? []

    // Check for video
    const videoAttr = attrs.find((a) => a._ === 'documentAttributeVideo')
    if (videoAttr) {
      const isAnimation = attrs.some((a) => a._ === 'documentAttributeAnimated')
      // Check for round video (video note / кружок)
      const isRound = 'roundMessage' in videoAttr && videoAttr.roundMessage
      return {
        type: isAnimation ? 'animation' : isRound ? 'video_note' : 'video',
        width: videoAttr.w,
        height: videoAttr.h,
        duration: videoAttr.duration,
        mimeType: doc.mimeType,
      }
    }

    // Check for audio
    const audioAttr = attrs.find((a) => a._ === 'documentAttributeAudio')
    if (audioAttr) {
      const isVoice = 'voice' in audioAttr
      return {
        type: isVoice ? 'voice' : 'audio',
        duration: audioAttr.duration,
        title: audioAttr.title,
        performer: audioAttr.performer,
        waveform: audioAttr.waveform ? Array.from(audioAttr.waveform) : undefined,
        mimeType: doc.mimeType,
      }
    }

    // Check for sticker
    const stickerAttr = attrs.find((a) => a._ === 'documentAttributeSticker')
    if (stickerAttr) {
      const imageAttr = attrs.find((a) => a._ === 'documentAttributeImageSize')
      const videoAttrForSticker = attrs.find((a) => a._ === 'documentAttributeVideo')
      
      // Determine sticker type based on mime and attributes
      let stickerType: 'static' | 'animated' | 'video' = 'static'
      if (doc.mimeType === 'application/x-tgsticker') {
        stickerType = 'animated'
      } else if (doc.mimeType === 'video/webm' || videoAttrForSticker) {
        stickerType = 'video'
      }
      
      return {
        type: 'sticker',
        width: imageAttr?.w ?? videoAttrForSticker?.w,
        height: imageAttr?.h ?? videoAttrForSticker?.h,
        stickerType,
        stickerEmoji: 'alt' in stickerAttr ? String(stickerAttr.alt) : undefined,
        mimeType: doc.mimeType,
      }
    }

    // Generic document
    const fileAttr = attrs.find((a) => a._ === 'documentAttributeFilename')
    return {
      type: 'document',
      fileName: fileAttr?.fileName,
      mimeType: doc.mimeType,
    }
  }

  // Geo location
  if ((type === 'messageMediaGeo' || type === 'messageMediaGeoLive') && media.geo) {
    return {
      type: 'location',
      latitude: media.geo.lat ?? 0,
      longitude: media.geo.long ?? 0,
    }
  }

  // Venue
  if (type === 'messageMediaVenue' && media.geo) {
    return {
      type: 'venue',
      latitude: media.geo.lat ?? 0,
      longitude: media.geo.long ?? 0,
      venueTitle: media.title ?? '',
      address: media.address ?? '',
    }
  }

  // Poll
  if (type === 'messageMediaPoll' && media.poll) {
    const results = media.results?.results ?? []
    return {
      type: 'poll',
      pollQuestion: media.poll.question?.text ?? '',
      pollAnswers: media.poll.answers?.map((a, i) => ({
        text: a.text?.text ?? '',
        voters: results[i]?.voters ?? 0,
      })) ?? [],
      pollVoters: results.reduce((sum, r) => sum + (r.voters ?? 0), 0),
    }
  }

  // Contact
  if (type === 'messageMediaContact') {
    return {
      type: 'contact',
      phoneNumber: media.phoneNumber ?? '',
      firstName: media.firstName ?? '',
      lastName: media.lastName ?? undefined,
      contactUserId: media.userId ?? undefined,
    }
  }

  // Dice
  if (type === 'messageMediaDice') {
    return {
      type: 'dice',
      emoji: media.emoticon ?? '🎲',
      value: media.value ?? 0,
    }
  }

  // Webpage
  if (type === 'messageMediaWebPage' && media.webpage && 'url' in media.webpage) {
    return {
      type: 'webpage',
      webpageUrl: media.webpage.url ?? '',
      webpageTitle: media.webpage.title ?? undefined,
      webpageDescription: media.webpage.description ?? undefined,
      webpageSiteName: media.webpage.siteName ?? undefined,
    }
  }

  return undefined
}

/**
 * Map TL entities to MessageEntity array
 */
function mapTLEntities(entities: TLMessage['entities']): MessageEntity[] | undefined {
  if (!entities || entities.length === 0) return undefined

  const result: MessageEntity[] = []

  for (const e of entities) {
    const base = { offset: e.offset, length: e.length }

    switch (e._) {
      case 'messageEntityBold':
        result.push({ ...base, type: 'bold' })
        break
      case 'messageEntityItalic':
        result.push({ ...base, type: 'italic' })
        break
      case 'messageEntityUnderline':
        result.push({ ...base, type: 'underline' })
        break
      case 'messageEntityStrike':
        result.push({ ...base, type: 'strikethrough' })
        break
      case 'messageEntityCode':
        result.push({ ...base, type: 'code' })
        break
      case 'messageEntityPre':
        result.push({ ...base, type: 'pre', language: e.language })
        break
      case 'messageEntityTextUrl':
        result.push({ ...base, type: 'link', url: e.url })
        break
      case 'messageEntityUrl':
        result.push({ ...base, type: 'url' })
        break
      case 'messageEntityMention':
        result.push({ ...base, type: 'mention' })
        break
      case 'messageEntityMentionName':
        result.push({ ...base, type: 'text_mention', userId: e.userId })
        break
      case 'messageEntityHashtag':
        result.push({ ...base, type: 'hashtag' })
        break
      case 'messageEntityCashtag':
        result.push({ ...base, type: 'cashtag' })
        break
      case 'messageEntityBotCommand':
        result.push({ ...base, type: 'bot_command' })
        break
      case 'messageEntityEmail':
        result.push({ ...base, type: 'email' })
        break
      case 'messageEntityPhone':
        result.push({ ...base, type: 'phone' })
        break
      case 'messageEntitySpoiler':
        result.push({ ...base, type: 'spoiler' })
        break
      case 'messageEntityBlockquote':
        result.push({ ...base, type: 'blockquote' })
        break
      case 'messageEntityCustomEmoji':
        result.push({ ...base, type: 'custom_emoji', emojiId: String(e.documentId) })
        break
      // Skip unknown types
    }
  }

  return result.length > 0 ? result : undefined
}

/**
 * Map TL forward info to MessageForward
 */
function mapTLForward(
  fwdFrom: TLMessage['fwdFrom'],
  users: Map<number, TLUser>,
  chats: Map<number, TLChat>
): MessageForward | undefined {
  if (!fwdFrom) return undefined

  let senderName = fwdFrom.fromName ?? 'Unknown'
  let senderId: number | undefined
  let isChannel = false

  if (fwdFrom.fromId) {
    if (fwdFrom.fromId._ === 'peerUser' && fwdFrom.fromId.userId) {
      const user = users.get(fwdFrom.fromId.userId)
      if (user) {
        senderName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'User'
      }
      senderId = fwdFrom.fromId.userId
    } else if (fwdFrom.fromId._ === 'peerChannel' && fwdFrom.fromId.channelId) {
      const chat = chats.get(fwdFrom.fromId.channelId)
      if (chat) {
        senderName = chat.title || 'Channel'
      }
      senderId = fwdFrom.fromId.channelId
      isChannel = true
    }
  }

  return {
    date: fwdFrom.date ? new Date(fwdFrom.date * 1000) : new Date(),
    senderName,
    senderId,
    isChannel,
    messageId: fwdFrom.channelPost,
    signature: fwdFrom.postAuthor,
  }
}

/**
 * Map high-level mtcute Message to Comment (for iterHistory response)
 * Uses mapMessage internally to get full media/entities/forward support
 * @param discussionMessageId - ID of the discussion message (thread root) to distinguish root comments from replies
 */
function mapHighLevelMessage(msg: TgMessage, discussionMessageId?: number): Comment | null {
  if (!msg.text && !msg.media) {
    return null
  }

  const msgAny = msg as TgMessage & {
    replyToMessageId?: number
    replyToMessage?: { id: number }
    chat?: { id: number }
  }

  // Use mapMessage to get media, entities, forward
  const chatId = msgAny.chat?.id ?? 0
  const mapped = mapMessage(msg, chatId)

  // Get reply-to ID - only set if it's a reply to another comment (not to thread root)
  const rawReplyToId = msgAny.replyToMessageId ?? msgAny.replyToMessage?.id
  const replyToId = (rawReplyToId && rawReplyToId !== discussionMessageId)
    ? rawReplyToId
    : undefined

  return {
    id: msg.id,
    text: msg.text ?? '',
    author: {
      id: msg.sender?.id ?? 0,
      name: msg.sender?.displayName ?? 'Unknown',
    },
    date: msg.date,
    replyToId,
    media: mapped?.media,
    entities: mapped?.entities,
    forward: mapped?.forward,
  }
}

/**
 * Resolve author information from TL fromId
 * Attempts to load profile photo asynchronously
 */
function resolveAuthor(
  fromId: TLMessage['fromId'],
  users: Map<number, TLUser>,
  chats: Map<number, TLChat>
): CommentAuthor {
  if (!fromId) {
    return { id: 0, name: 'Unknown' }
  }

  if (fromId._ === 'peerUser' && fromId.userId) {
    const user = users.get(fromId.userId)
    if (user) {
      const name =
        [user.firstName, user.lastName].filter(Boolean).join(' ') ||
        user.username ||
        'User'

      // Check if user has a profile photo
      const hasPhoto = user.photo && user.photo._ !== 'userProfilePhotoEmpty'

      return {
        id: fromId.userId,
        name,
        // Photo will be loaded lazily via downloadProfilePhoto when needed
        photo: hasPhoto ? `user:${fromId.userId}` : undefined,
      }
    }
    return { id: fromId.userId, name: 'User' }
  }

  if (fromId._ === 'peerChannel' && fromId.channelId) {
    const chat = chats.get(fromId.channelId)
    if (chat) {
      return {
        id: fromId.channelId,
        name: chat.title || 'Channel',
        // Channel photos loaded lazily
        photo: `channel:${fromId.channelId}`,
      }
    }
    return { id: fromId.channelId, name: 'Channel' }
  }

  return { id: 0, name: 'Unknown' }
}

/**
 * Map TL reactions to CommentReaction array
 */
function mapReactions(
  reactions: TLMessage['reactions']
): CommentReaction[] | undefined {
  if (!reactions?.results || reactions.results.length === 0) {
    return undefined
  }

  return reactions.results
    .filter((r) => r.reaction?.emoticon)
    .map((r) => ({
      emoji: r.reaction.emoticon!,
      count: r.count,
    }))
}

/**
 * Build a tree structure from flat comments
 * Handles orphaned replies and avoids mutation
 */
function buildCommentTree(comments: Comment[]): Comment[] {
  // Create a deep copy to avoid mutation
  const commentsCopy = comments.map((c) => ({ ...c, replies: [] as Comment[] }))
  const commentMap = new Map<number, Comment>()
  const rootComments: Comment[] = []

  // First pass: build lookup map
  for (const comment of commentsCopy) {
    commentMap.set(comment.id, comment)
  }

  // Second pass: build tree structure and resolve replyToAuthor
  for (const comment of commentsCopy) {
    const parentId = comment.replyToId
    const parent = parentId ? commentMap.get(parentId) : undefined

    if (parent) {
      // Resolve reply-to author from parent comment
      comment.replyToAuthor = { name: parent.author.name }
      // replies is initialized in commentsCopy above, but use defensive check
      if (!parent.replies) parent.replies = []
      parent.replies.push(comment)
    } else {
      // This is either a root comment or an orphaned reply
      // We treat orphaned replies as root comments
      rootComments.push(comment)
    }
  }

  // Sort: root comments newest first, replies oldest first (chronological)
  rootComments.sort((a, b) => getTime(b.date) - getTime(a.date))

  const sortRepliesRecursive = (comment: Comment) => {
    if (comment.replies && comment.replies.length > 0) {
      comment.replies.sort((a, b) => getTime(a.date) - getTime(b.date))
      comment.replies.forEach(sortRepliesRecursive)
    }
  }

  rootComments.forEach(sortRepliesRecursive)

  return rootComments
}
