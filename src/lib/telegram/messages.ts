import { getTelegramClient } from './client'
import type {
  Message as TgMessage,
  Photo,
  Video,
  Document as TgDocument,
  Sticker,
  Audio,
  Voice,
  Location,
  LiveLocation,
  Venue,
  Poll,
  Contact,
  Dice,
  WebPageMedia,
} from '@mtcute/web'
import type { tl } from '@mtcute/web'
import { strippedToDataUrl } from './media'

/**
 * Extract stripped thumbnail from photo/document sizes as data URL
 */
function getStrippedThumb(sizes: tl.TypePhotoSize[] | undefined): string | undefined {
  if (!sizes) return undefined
  
  for (const size of sizes) {
    if (size._ === 'photoStrippedSize') {
      return strippedToDataUrl(size.bytes)
    }
  }
  return undefined
}

export interface MessageReaction {
  emoji: string
  count: number
  chosen?: boolean
}

export interface MessageForward {
  date: Date
  senderName: string
  senderId?: number
  isChannel?: boolean
  messageId?: number
  signature?: string
}

export interface Message {
  id: number
  channelId: number
  text: string
  date: Date
  views?: number
  forwards?: number
  replies?: number
  editDate?: Date
  author?: {
    id: number
    name: string
    photo?: string
  }
  forward?: MessageForward
  media?: MessageMedia
  entities?: MessageEntity[]
  replyTo?: number
  groupedId?: bigint
  reactions?: MessageReaction[]
}

// ============================================================================
// Discriminated Union for MessageMedia - proper type safety!
// ============================================================================

/** Base fields shared by visual media types */
interface MediaWithDimensions {
  url?: string
  /** Base64-encoded stripped thumbnail bytes (needs conversion to JPEG) */
  thumb?: string
  width?: number
  height?: number
}

/** Base fields for downloadable media */
interface MediaWithFile {
  url?: string
  fileName?: string
  mimeType?: string
  size?: number
}

export interface PhotoMedia extends MediaWithDimensions {
  type: 'photo'
}

export interface VideoMedia extends MediaWithDimensions {
  type: 'video'
  duration?: number
  mimeType?: string
}

export interface VideoNoteMedia extends MediaWithDimensions {
  type: 'video_note'
  duration?: number
  mimeType?: string
}

export interface AnimationMedia extends MediaWithDimensions {
  type: 'animation'
  duration?: number
  mimeType?: string
}

export interface DocumentMedia extends MediaWithFile {
  type: 'document'
  thumb?: string
}

export interface AudioMedia extends MediaWithFile {
  type: 'audio'
  duration?: number
  performer?: string
  title?: string
}

export interface VoiceMedia {
  type: 'voice'
  url?: string
  duration?: number
  waveform?: number[]
  mimeType?: string
  size?: number
}

export interface StickerMedia extends MediaWithDimensions {
  type: 'sticker'
  stickerType?: 'static' | 'animated' | 'video'
  stickerEmoji?: string
  mimeType?: string
}

export interface LocationMedia {
  type: 'location'
  latitude: number
  longitude: number
  /** Live location heading */
  heading?: number
  /** Live location period */
  period?: number
}

export interface VenueMedia {
  type: 'venue'
  latitude: number
  longitude: number
  venueTitle: string
  address: string
}

export interface PollAnswer {
  text: string
  voters: number
  chosen?: boolean
  correct?: boolean
}

export interface PollMedia {
  type: 'poll'
  pollQuestion: string
  pollAnswers: PollAnswer[]
  pollVoters: number
  pollClosed?: boolean
  pollQuiz?: boolean
  pollMultiple?: boolean
}

export interface ContactMedia {
  type: 'contact'
  phoneNumber: string
  firstName: string
  lastName?: string
  contactUserId?: number
}

export interface DiceMedia {
  type: 'dice'
  emoji: string
  value: number
}

export interface WebpageMedia {
  type: 'webpage'
  url?: string
  thumb?: string
  webpageUrl: string
  webpageTitle?: string
  webpageDescription?: string
  webpageSiteName?: string
  webpagePhoto?: { width?: number; height?: number }
}

/** Discriminated union of all media types (strict) */
export type MessageMediaStrict =
  | PhotoMedia
  | VideoMedia
  | VideoNoteMedia
  | AnimationMedia
  | DocumentMedia
  | AudioMedia
  | VoiceMedia
  | StickerMedia
  | LocationMedia
  | VenueMedia
  | PollMedia
  | ContactMedia
  | DiceMedia
  | WebpageMedia

/**
 * MessageMedia with all fields optional for easier use in components.
 * SolidJS's Match doesn't narrow TypeScript types, so we need this flexibility.
 * Use MessageMediaStrict when you need precise type checking.
 */
export interface MessageMedia {
  type: 'photo' | 'video' | 'video_note' | 'document' | 'audio' | 'voice' | 'sticker' | 'animation' | 'location' | 'venue' | 'poll' | 'contact' | 'dice' | 'webpage'
  url?: string
  thumb?: string
  width?: number
  height?: number
  duration?: number
  fileName?: string
  mimeType?: string
  size?: number
  performer?: string
  title?: string
  waveform?: number[]
  latitude?: number
  longitude?: number
  heading?: number
  period?: number
  venueTitle?: string
  address?: string
  pollQuestion?: string
  pollAnswers?: PollAnswer[]
  pollVoters?: number
  pollClosed?: boolean
  pollQuiz?: boolean
  pollMultiple?: boolean
  phoneNumber?: string
  firstName?: string
  lastName?: string
  contactUserId?: number
  stickerType?: 'static' | 'animated' | 'video'
  stickerEmoji?: string
  emoji?: string
  value?: number
  webpageUrl?: string
  webpageTitle?: string
  webpageDescription?: string
  webpageSiteName?: string
  webpagePhoto?: { width?: number; height?: number }
}

/** Helper type to get media by type */
export type MediaOfType<T extends MessageMedia['type']> = Extract<MessageMediaStrict, { type: T }>

export interface MessageEntity {
  type:
    | 'bold'
    | 'italic'
    | 'underline'
    | 'strikethrough'
    | 'code'
    | 'pre'
    | 'link'
    | 'mention'
    | 'text_mention'
    | 'hashtag'
    | 'cashtag'
    | 'bot_command'
    | 'url'
    | 'email'
    | 'phone'
    | 'spoiler'
    | 'blockquote'
    | 'custom_emoji'
  offset: number
  length: number
  url?: string
  language?: string
  userId?: number
  emojiId?: string
}

export interface FetchMessagesOptions {
  limit?: number
  offsetId?: number
  minId?: number
  maxId?: number
}

/**
 * Extra messages to fetch to ensure we don't cut media groups
 * Telegram albums can have up to 10 items
 */
const GROUP_BUFFER = 10

/**
 * Fetch messages from a channel
 * 
 * Fetches extra messages to ensure media groups (albums) are complete,
 * then trims the result without cutting groups in the middle.
 */
export async function fetchMessages(
  channelId: number,
  options: FetchMessagesOptions = {}
): Promise<Message[]> {
  const client = getTelegramClient()
  const messages: Message[] = []
  const limit = options.limit ?? 20

  // Fetch extra to avoid cutting groups at boundary
  const fetchLimit = limit + GROUP_BUFFER

  const iterOptions: { limit: number; maxId?: number } = { limit: fetchLimit }
  if (options.offsetId) iterOptions.maxId = options.offsetId
  if (options.maxId) iterOptions.maxId = options.maxId

  for await (const msg of client.iterHistory(channelId, iterOptions)) {
    if (msg) {
      const mapped = mapMessage(msg, channelId)
      if (mapped) {
        messages.push(mapped)
      }
    }
  }

  // Trim to limit without cutting groups
  return sliceWithCompleteGroups(messages, limit)
}

/**
 * Slice messages array without cutting media groups in the middle
 * 
 * If the message at the cut point has a groupedId, includes all messages
 * from that group (both before and after the cut point).
 */
export function sliceWithCompleteGroups(messages: Message[], limit: number): Message[] {
  if (messages.length <= limit) return messages
  
  const messageAtLimit = messages[limit - 1]
  
  // No group at boundary - simple slice
  if (!messageAtLimit?.groupedId) {
    return messages.slice(0, limit)
  }
  
  // Find where this group ends
  const groupId = messageAtLimit.groupedId.toString()
  let endIndex = limit
  
  while (endIndex < messages.length) {
    const msg = messages[endIndex]
    if (!msg?.groupedId || msg.groupedId.toString() !== groupId) {
      break
    }
    endIndex++
  }
  
  return messages.slice(0, endIndex)
}

/**
 * Fetch a single message by ID
 */
export async function getMessage(
  channelId: number,
  messageId: number
): Promise<Message | null> {
  const client = getTelegramClient()

  try {
    // getMessages takes peer and array of message IDs
    const messages = await client.getMessages(channelId, [messageId])
    if (Array.isArray(messages) && messages.length > 0 && messages[0]) {
      return mapMessage(messages[0], channelId)
    }
    return null
  } catch {
    // Fallback to iteration
    for await (const msg of client.iterHistory(channelId, { limit: 50 })) {
      if (msg.id === messageId) {
        return mapMessage(msg, channelId)
      }
    }
    return null
  }
}

/**
 * Fetch unified timeline from multiple channels
 *
 * Optimized for speed:
 * - Fetches channels in parallel
 * - Limited posts to reduce media load
 */
export async function fetchTimeline(
  channelIds: number[],
  options: FetchMessagesOptions = {}
): Promise<Message[]> {
  const limit = options.limit ?? 30 // Reduced from 50

  // Limit channels to reduce concurrent requests
  const selectedChannels = channelIds.slice(0, 10) // Reduced from 15

  // Fetch all channels in parallel
  const results = await Promise.allSettled(
    selectedChannels.map((id) =>
      fetchMessages(id, { limit: 5 }) // 5 messages per channel
    )
  )

  const allMessages: Message[] = []
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allMessages.push(...result.value)
    }
  }

  allMessages.sort((a, b) => b.date.getTime() - a.date.getTime())
  return sliceWithCompleteGroups(allMessages, limit)
}

/**
 * Result from fetching more history for a single channel
 */
export interface HistoryResult {
  channelId: number
  messages: Message[]
  oldestId: number
  hasMore: boolean
}

/**
 * Fetch more history for channels during lazy loading
 *
 * Used when user scrolls down - fetches older messages from channels
 * that have more history available.
 *
 * @param offsets - Map of channelId -> { oldestId, hasMore }
 * @param limit - Number of messages to fetch per channel (default 10)
 * @returns Array of results with messages and updated offset info
 */
export async function fetchMoreHistory(
  offsets: Map<number, { oldestId: number; hasMore: boolean }>,
  limit: number = 10
): Promise<HistoryResult[]> {
  const client = getTelegramClient()

  // Filter channels that have more history
  const channelsToFetch = Array.from(offsets.entries())
    .filter(([_, offset]) => offset.hasMore && offset.oldestId > 0)
    .slice(0, 5) // Max 5 parallel requests to avoid rate limits

  if (channelsToFetch.length === 0) {
    return []
  }

  // Fetch history for each channel in parallel
  const results = await Promise.allSettled(
    channelsToFetch.map(async ([channelId, offset]) => {
      const messages: Message[] = []

      // Use maxId to get messages older than the current oldest
      for await (const msg of client.iterHistory(channelId, {
        limit,
        maxId: offset.oldestId,
      })) {
        if (msg) {
          const mapped = mapMessage(msg, channelId)
          if (mapped) {
            messages.push(mapped)
          }
        }
        if (messages.length >= limit) break
      }

      // Determine if there are more messages
      const hasMore = messages.length >= limit
      const oldestId = messages.length > 0
        ? Math.min(...messages.map((m) => m.id))
        : offset.oldestId

      return {
        channelId,
        messages,
        oldestId,
        hasMore,
      } as HistoryResult
    })
  )

  // Extract successful results
  const historyResults: HistoryResult[] = []
  for (const result of results) {
    if (result.status === 'fulfilled') {
      historyResults.push(result.value)
    }
  }

  return historyResults
}

// Helpers - exported for use in channels.ts and updates.ts

export function mapMessage(msg: TgMessage, channelId: number): Message | null {
  // Skip service messages (no text and no media)
  // Examples: pinned message notifications, user joined, etc.
  if (!msg.text && !msg.media) {
    return null
  }

  return {
    id: msg.id,
    channelId,
    text: msg.text ?? '',
    date: msg.date,
    views: msg.views ?? undefined,
    forwards: msg.forwards ?? undefined,
    replies: msg.replies?.count ?? undefined,
    editDate: msg.editDate && !msg.hideEditMark ? msg.editDate : undefined,
    author: msg.sender
      ? {
          id: msg.sender.id,
          name: msg.sender.displayName,
        }
      : undefined,
    forward: mapForward(msg),
    media: mapMedia(msg),
    entities: mapEntities(msg),
    replyTo: msg.replyToMessage?.id ?? undefined,
    groupedId: msg.groupedId ? BigInt(msg.groupedId.toString()) : undefined,
    reactions: mapReactions(msg),
  }
}

function mapForward(msg: TgMessage): MessageForward | undefined {
  const fwd = msg.forward
  if (!fwd) return undefined

  const sender = fwd.sender
  // sender can be Peer (User/Chat), AnonymousSender, or string
  let senderName: string
  let senderId: number | undefined
  let isChannel = false

  if (typeof sender === 'string') {
    // Hidden forward - just a name string
    senderName = sender
  } else if (sender && 'type' in sender && sender.type === 'anonymous') {
    // AnonymousSender - has displayName but no id
    senderName = sender.displayName
  } else if (sender && 'id' in sender) {
    // Peer (User or Chat) - has id and displayName
    senderName = sender.displayName
    senderId = sender.id
    // Check if it's a channel (has 'username' property but no 'firstName')
    isChannel = 'username' in sender && !('firstName' in sender)
  } else {
    senderName = 'Unknown'
  }

  return {
    date: fwd.date,
    senderName,
    senderId,
    isChannel,
    messageId: fwd.fromMessageId ?? undefined,
    signature: fwd.signature ?? undefined,
  }
}

function mapReactions(msg: TgMessage): MessageReaction[] | undefined {
  // Access reactions through the mtcute Message class
  const reactions = msg.reactions
  if (!reactions) return undefined

  const reactionCounts = reactions.reactions
  if (!reactionCounts || reactionCounts.length === 0) return undefined

  const mapped: MessageReaction[] = []

  for (const rc of reactionCounts) {
    // Skip paid reactions (stars) - not supported
    if (rc.isPaid) continue

    const emoji = rc.emoji
    // Skip custom emojis (non-string) - can't display them properly
    if (typeof emoji !== 'string') continue

    mapped.push({
      emoji,
      count: rc.count,
      // order !== null means current user has reacted with this emoji
      chosen: rc.order !== null,
    })
  }

  return mapped.length > 0 ? mapped : undefined
}

function mapMedia(msg: TgMessage): MessageMedia | undefined {
  if (!msg.media) return undefined

  const media = msg.media

  if (media.type === 'photo') {
    const photo = media as Photo
    return {
      type: 'photo',
      width: photo.width,
      height: photo.height,
      thumb: getStrippedThumb(photo.raw.sizes),
    }
  }

  if (media.type === 'video') {
    const video = media as Video
    const thumb = getStrippedThumb(video.raw.thumbs)
    // Check if it's an animation (GIF)
    if (video.isAnimation) {
      return {
        type: 'animation',
        width: video.width,
        height: video.height,
        duration: video.duration,
        mimeType: video.mimeType,
        thumb,
      }
    }
    // Check if it's a round video (video note / кружок)
    if (video.isRound) {
      return {
        type: 'video_note',
        width: video.width,
        height: video.height,
        duration: video.duration,
        mimeType: video.mimeType,
        thumb,
      }
    }
    return {
      type: 'video',
      width: video.width,
      height: video.height,
      duration: video.duration,
      mimeType: video.mimeType,
      thumb,
    }
  }

  if (media.type === 'audio') {
    const audio = media as Audio
    return {
      type: 'audio',
      duration: audio.duration,
      performer: audio.performer ?? undefined,
      title: audio.title ?? undefined,
      fileName: audio.fileName ?? undefined,
      mimeType: audio.mimeType,
      size: audio.fileSize,
    }
  }

  if (media.type === 'voice') {
    const voice = media as Voice
    return {
      type: 'voice',
      duration: voice.duration,
      waveform: voice.waveform,
      mimeType: voice.mimeType,
      size: voice.fileSize,
    }
  }

  if (media.type === 'document') {
    const doc = media as TgDocument
    return {
      type: 'document',
      fileName: doc.fileName ?? undefined,
      mimeType: doc.mimeType,
      size: doc.fileSize,
      thumb: getStrippedThumb(doc.raw.thumbs),
    }
  }

  if (media.type === 'sticker') {
    const sticker = media as Sticker
    return {
      type: 'sticker',
      width: sticker.width,
      height: sticker.height,
      stickerType: sticker.sourceType,
      stickerEmoji: sticker.emoji || undefined,
      mimeType: sticker.mimeType,
      thumb: getStrippedThumb(sticker.raw.thumbs),
    }
  }

  if (media.type === 'location') {
    const loc = media as Location
    return {
      type: 'location',
      latitude: loc.latitude,
      longitude: loc.longitude,
    }
  }

  if (media.type === 'live_location') {
    const loc = media as LiveLocation
    return {
      type: 'location',
      latitude: loc.latitude,
      longitude: loc.longitude,
      heading: loc.heading ?? undefined,
      period: loc.period,
    }
  }

  if (media.type === 'venue') {
    const venue = media as Venue
    return {
      type: 'venue',
      latitude: venue.location.latitude,
      longitude: venue.location.longitude,
      venueTitle: venue.title,
      address: venue.address,
    }
  }

  if (media.type === 'poll') {
    const poll = media as Poll
    return {
      type: 'poll',
      pollQuestion: poll.question,
      pollAnswers: poll.answers.map((a) => ({
        text: a.text,
        voters: a.voters,
        chosen: a.chosen || undefined,
        correct: a.correct || undefined,
      })),
      pollVoters: poll.voters,
      pollClosed: poll.isClosed || undefined,
      pollQuiz: poll.isQuiz || undefined,
      pollMultiple: poll.isMultiple || undefined,
    }
  }

  if (media.type === 'contact') {
    const contact = media as Contact
    return {
      type: 'contact',
      phoneNumber: contact.phoneNumber,
      firstName: contact.firstName,
      lastName: contact.lastName,
      contactUserId: contact.userId || undefined,
    }
  }

  if (media.type === 'dice') {
    const dice = media as Dice
    return {
      type: 'dice',
      emoji: dice.emoji,
      value: dice.value,
    }
  }

  if (media.type === 'webpage') {
    const webpage = media as WebPageMedia
    const preview = webpage.preview
    return {
      type: 'webpage',
      webpageUrl: preview.url,
      webpageTitle: preview.title ?? undefined,
      webpageDescription: preview.description ?? undefined,
      webpageSiteName: preview.siteName ?? undefined,
      webpagePhoto: preview.photo ? {
        width: preview.photo.width,
        height: preview.photo.height,
      } : undefined,
      thumb: preview.photo ? getStrippedThumb(preview.photo.raw.sizes) : undefined,
    }
  }

  // Unknown media type - log for debugging
  if (import.meta.env.DEV) {
    console.log('[mapMedia] Unknown media type:', media.type)
  }
  return undefined
}

function mapEntities(msg: TgMessage): MessageEntity[] | undefined {
  if (!msg.entities || msg.entities.length === 0) return undefined

  const result: MessageEntity[] = []

  for (const entity of msg.entities) {
    try {
      const base = { offset: entity.offset, length: entity.length }
      const kind = entity.kind

      switch (kind) {
        case 'bold':
          result.push({ ...base, type: 'bold' })
          break
        case 'italic':
          result.push({ ...base, type: 'italic' })
          break
        case 'underline':
          result.push({ ...base, type: 'underline' })
          break
        case 'strikethrough':
          result.push({ ...base, type: 'strikethrough' })
          break
        case 'code':
          result.push({ ...base, type: 'code' })
          break
        case 'pre':
          result.push({
            ...base,
            type: 'pre',
            language: entity.is('pre') ? entity.params.language : undefined,
          })
          break
        case 'text_link':
          result.push({
            ...base,
            type: 'link',
            url: entity.is('text_link') ? entity.params.url : undefined,
          })
          break
        case 'url':
          result.push({ ...base, type: 'url' })
          break
        case 'mention':
          result.push({ ...base, type: 'mention' })
          break
        case 'text_mention':
          result.push({
            ...base,
            type: 'text_mention',
            userId: entity.is('text_mention') ? entity.params.userId : undefined,
          })
          break
        case 'hashtag':
          result.push({ ...base, type: 'hashtag' })
          break
        case 'cashtag':
          result.push({ ...base, type: 'cashtag' })
          break
        case 'bot_command':
          result.push({ ...base, type: 'bot_command' })
          break
        case 'email':
          result.push({ ...base, type: 'email' })
          break
        case 'phone_number':
          result.push({ ...base, type: 'phone' })
          break
        case 'spoiler':
          result.push({ ...base, type: 'spoiler' })
          break
        case 'blockquote':
          result.push({ ...base, type: 'blockquote' })
          break
        case 'bank_card':
          // Bank card numbers - render as code
          result.push({ ...base, type: 'code' })
          break
        case 'unknown':
          // Skip unknown entity types
          break
      }
    } catch {
      // Skip malformed entities
    }
  }

  return result.length > 0 ? result : undefined
}

// Cache for global available reactions
let cachedGlobalReactions: string[] | null = null

/**
 * Send a reaction to a message using mtcute's built-in method
 *
 * @param channelId - Channel/chat ID
 * @param messageId - Message ID to react to
 * @param emoji - Emoji reaction (or null to remove reaction)
 * @returns Updated reactions array or null on error
 */
/**
 * Toggle a reaction on a message
 * Supports multiple reactions per user - toggles the clicked emoji while preserving others
 *
 * @param channelId - Channel ID
 * @param messageId - Message ID
 * @param emoji - Emoji to toggle
 * @param currentChosenEmojis - Array of currently chosen emojis by the user
 */
export async function sendReaction(
  channelId: number,
  messageId: number,
  emoji: string,
  currentChosenEmojis: string[]
): Promise<MessageReaction[] | null> {
  const client = getTelegramClient()

  try {
    // Defensive: ensure array is valid
    const safeChosenEmojis = currentChosenEmojis ?? []

    // Toggle the emoji: remove if already chosen, add if not
    const isChosen = safeChosenEmojis.includes(emoji)
    let newEmojis: string[]

    if (isChosen) {
      // Remove this emoji from chosen list
      newEmojis = safeChosenEmojis.filter((e) => e !== emoji)
    } else {
      // Add this emoji to chosen list
      newEmojis = [...safeChosenEmojis, emoji]
    }

    // Send the full array of reactions (or undefined to clear all)
    const result = await client.sendReaction({
      chatId: channelId,
      message: messageId,
      emoji: newEmojis.length > 0 ? newEmojis : undefined,
    })

    if (result) {
      const mapped = mapMessage(result, channelId)
      return mapped?.reactions ?? null
    }

    return null
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('[sendReaction] Error:', error)
    }
    return null
  }
}

/**
 * Default emoji reactions available in Telegram
 * Used when channel allows all reactions
 */
const DEFAULT_REACTIONS = ['👍', '👎', '❤️', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '😱', '🤬', '😢', '🎉', '🤩', '🤮', '💩', '🙏']

/**
 * Fetch global available reactions from Telegram
 * Falls back to default list if API fails
 */
async function fetchGlobalReactions(): Promise<string[]> {
  if (cachedGlobalReactions) {
    return cachedGlobalReactions
  }

  const client = getTelegramClient()

  try {
    const result = await (client as any).call({
      _: 'messages.getAvailableReactions',
      hash: 0,
    })

    if (import.meta.env.DEV) {
      console.log('[fetchGlobalReactions] Raw result:', result?._)
    }

    // Handle different response types
    if (result?._ === 'messages.availableReactions' && result.reactions) {
      const reactions = result.reactions
        .filter((r: any) => r._ === 'availableReaction' && !r.inactive)
        .map((r: any) => {
          // Try different ways to get the emoticon
          if (typeof r.reaction === 'string') {
            return r.reaction
          }
          if (r.reaction?.emoticon) {
            return r.reaction.emoticon
          }
          if (r.reaction?._ === 'reactionEmoji') {
            return r.reaction.emoticon
          }
          return null
        })
        .filter(Boolean) as string[]

      if (reactions.length > 0) {
        if (import.meta.env.DEV) {
          console.log('[fetchGlobalReactions] Parsed reactions:', reactions.length)
        }
        cachedGlobalReactions = reactions
        return reactions
      }
    }

    // Fallback to default
    if (import.meta.env.DEV) {
      console.log('[fetchGlobalReactions] Using default reactions')
    }
    cachedGlobalReactions = DEFAULT_REACTIONS
    return DEFAULT_REACTIONS
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('[fetchGlobalReactions] Error, using defaults:', error)
    }
    cachedGlobalReactions = DEFAULT_REACTIONS
    return DEFAULT_REACTIONS
  }
}

/**
 * Get available reactions for a channel
 * Uses mtcute's getFullChat to get available reactions from channel settings
 */
export async function getAvailableReactions(channelId: number): Promise<string[]> {
  const client = getTelegramClient()

  try {
    // Use mtcute's built-in getFullChat method
    const fullChat = await client.getFullChat(channelId)
    const availableReactions = fullChat.availableReactions

    if (import.meta.env.DEV) {
      console.log('[getAvailableReactions] Channel:', channelId, 'type:', availableReactions?._)
    }

    // chatReactionsNone - reactions are explicitly disabled
    if (availableReactions?._ === 'chatReactionsNone') {
      if (import.meta.env.DEV) {
        console.log('[getAvailableReactions] Reactions disabled for channel')
      }
      return []
    }

    // Channel has specific reactions allowed
    if (availableReactions?._ === 'chatReactionsSome') {
      const reactions = availableReactions.reactions
        ?.map((r: any) => {
          if (typeof r === 'string') return r
          if (r.emoticon) return r.emoticon
          if (r._ === 'reactionEmoji') return r.emoticon
          return null
        })
        .filter(Boolean) as string[]

      if (import.meta.env.DEV) {
        console.log('[getAvailableReactions] Specific reactions:', reactions)
      }
      return reactions ?? fetchGlobalReactions()
    }

    // No config, chatReactionsAll, or unknown - use global reactions
    return fetchGlobalReactions()
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('[getAvailableReactions] Error, using defaults:', error)
    }
    // On error, return defaults so user can still react
    return DEFAULT_REACTIONS
  }
}
