import { getTelegramClient, waitForClientReady } from './client'
import { mapMessage } from './messages'
import { MAX_DIALOGS_TO_ITERATE } from '@/config/constants'
import Long from 'long'
import type { Chat, Message as TgMessage, tl } from '@mtcute/web'
import type { Message } from './messages'

// Type declarations for debug functions exposed on window
declare global {
  interface Window {
    debugCheckLyMusic?: typeof debugCheckLyMusic
    debugVerifyFolderId?: typeof debugVerifyFolderId
  }
}

/** Telegram channel ID offset for "marked" IDs */
const CHANNEL_ID_OFFSET = -1000000000000

export interface Channel {
  id: number
  accessHash: bigint
  title: string
  username?: string
  photo?: string
  participantsCount?: number
  description?: string
  linkedChatId?: number
  /** Whether this channel is in the archived folder */
  isArchived?: boolean
}

/**
 * Extended channel info with full details
 * Fetched separately via getChannelFullInfo for detailed channel view
 */
export interface ChannelFullInfo extends Channel {
  /** Channel description/bio */
  description?: string
  /** Number of subscribers */
  participantsCount?: number
  /** Number of online members (if available) */
  onlineCount?: number
  /** Linked discussion group ID */
  linkedChatId?: number
  /** Channel creation date */
  createdAt?: Date
  /** Whether the channel is verified */
  isVerified?: boolean
  /** Whether the channel is a scam */
  isScam?: boolean
  /** Whether the channel is fake */
  isFake?: boolean
  /** Invite link (if available) */
  inviteLink?: string
  /** Slow mode delay in seconds (if enabled) */
  slowmodeSeconds?: number
  /** Whether content is protected (no forwards) */
  isProtected?: boolean
}

/**
 * Channel with optional lastMessage - used for optimized timeline initialization
 */
export interface ChannelWithLastMessage extends Channel {
  lastMessage?: Message
}

/**
 * Result of fetching channels with their last messages
 * Includes additional posts from media groups (albums)
 */
export interface ChannelsWithPostsResult {
  /** All channels (including archived) - store all for proper tracking */
  channels: ChannelWithLastMessage[]
  /** Additional posts from media groups - needed to display complete albums */
  groupedPosts: Message[]
}

/**
 * Fetch all subscribed channels
 *
 * Channels are cached with staleTime: Infinity, so this only runs:
 * - On first app load (no cache)
 * - After cache expiry (7 days)
 * - On explicit refresh by user
 */
export async function fetchChannels(): Promise<Channel[]> {
  const client = getTelegramClient()
  const channels: Channel[] = []

  const iterator = client.iterDialogs()[Symbol.asyncIterator]()
  let dialogCount = 0

  while (dialogCount < MAX_DIALOGS_TO_ITERATE) {
    try {
      const { value: dialog, done } = await iterator.next()
      if (done) break

      dialogCount++
      const peer = dialog.peer

      // Skip users and secret chats
      if (peer.type !== 'chat') continue
      const chat = peer as Chat
      if (chat.chatType === 'channel' && !isGroupChat(chat)) {
        channels.push(mapChatToChannel(chat))
      }
    } catch (e: unknown) {
      // Skip unsupported dialog types and continue
      const message = e instanceof Error ? e.message : ''
      if (message.includes('Secret') || message.includes('Unsupported')) {
        continue
      }
      // For rate limits or other errors, stop
      break
    }
  }

  return channels
}

/**
 * Fetch all subscribed channels WITH their last messages
 *
 * This is the optimized version - extracts lastMessage from dialogs
 * instead of making separate API calls for each channel.
 *
 * For messages that are part of a media group (album), fetches the complete
 * group using getMessageGroup API.
 *
 * IMPORTANT: Only fetches channels from main folder (folderId=0).
 * Archived channels are excluded entirely - updates from them will be ignored.
 *
 * PERFORMANCE: 1 API call for dialogs + 1 call per album group
 */
export async function fetchChannelsWithLastMessages(): Promise<ChannelsWithPostsResult> {
  const startTime = performance.now()
  if (import.meta.env.DEV) {
    console.log('[Channels] Starting fetchChannelsWithLastMessages...')
  }

  const client = getTelegramClient()
  const channels: ChannelWithLastMessage[] = []
  // Track messages that are part of groups - we'll fetch complete groups later
  const groupedMessages: Array<{ channelId: number; messageId: number; groupedId: bigint }> = []

  // Only fetch from main folder (folderId=0), exclude archived
  const iterator = client.iterDialogs({ archived: 'exclude' })[Symbol.asyncIterator]()
  let dialogCount = 0

  while (dialogCount < MAX_DIALOGS_TO_ITERATE) {
    try {
      const { value: dialog, done } = await iterator.next()
      if (done) break

      dialogCount++

      const peer = dialog.peer

      // Skip users and secret chats
      if (peer.type !== 'chat') continue
      const chat = peer as Chat
      
      if (chat.chatType === 'channel' && !isGroupChat(chat)) {
        const channel = mapChatToChannel(chat)

        // Extract lastMessage from dialog
        const lastMessage = dialog.lastMessage
        let mappedLastMessage: Message | undefined

        if (lastMessage) {
          try {
            const mapped = mapMessage(lastMessage as TgMessage, channel.id)
            if (mapped) {
              mappedLastMessage = mapped
              
              // Track album groups
              if (mapped.groupedId) {
                groupedMessages.push({
                  channelId: channel.id,
                  messageId: mapped.id,
                  groupedId: mapped.groupedId,
                })
              }
            }
          } catch {
            // Skip messages that fail to map
          }
        }

        channels.push({
          ...channel,
          lastMessage: mappedLastMessage,
        })
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : ''
      if (message.includes('Secret') || message.includes('Unsupported')) {
        continue
      }
      break
    }
  }

  if (import.meta.env.DEV) {
    console.log(`[Channels] Done! ${channels.length} channels from ${dialogCount} dialogs in ${Math.round(performance.now() - startTime)}ms`)
  }

  // Fetch complete groups for messages that are part of albums
  const groupedPosts: Message[] = []
  
  if (groupedMessages.length > 0) {
    if (import.meta.env.DEV) {
      console.log(`[Channels] Fetching ${groupedMessages.length} media groups...`)
    }

    // Collect existing IDs to avoid duplicates
    const existingIds = new Set(
      channels.map((c: ChannelWithLastMessage) => c.lastMessage ? `${c.lastMessage.channelId}:${c.lastMessage.id}` : null).filter(Boolean)
    )

    // Fetch groups in small batches to avoid FLOOD_WAIT
    const BATCH_SIZE = 5
    for (let i = 0; i < groupedMessages.length; i += BATCH_SIZE) {
      const batch = groupedMessages.slice(i, i + BATCH_SIZE)
      
      const results = await Promise.allSettled(
        batch.map(async ({ channelId, messageId }) => {
          const groupMessages = await client.getMessageGroup({ chatId: channelId, message: messageId })
          return groupMessages.map((msg) => mapMessage(msg as TgMessage, channelId)).filter(Boolean) as Message[]
        })
      )

      for (const result of results) {
        if (result.status === 'fulfilled') {
          for (const msg of result.value) {
            const key = `${msg.channelId}:${msg.id}`
            if (!existingIds.has(key)) {
              groupedPosts.push(msg)
              existingIds.add(key)
            }
          }
        }
      }

      // Small delay between batches
      if (i + BATCH_SIZE < groupedMessages.length) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    if (import.meta.env.DEV) {
      console.log(`[Channels] Fetched ${groupedPosts.length} additional posts from media groups`)
    }
  }

  return { channels, groupedPosts }
}

/**
 * Get a single channel by ID or username
 */
export async function getChannel(idOrUsername: string | number): Promise<Channel | null> {
  const ready = await waitForClientReady()
  if (!ready) return null

  const client = getTelegramClient()

  try {
    const chat = await client.getChat(idOrUsername)
    if (chat.chatType === 'channel' && !isGroupChat(chat)) {
      return mapChatToChannel(chat)
    }
    return null
  } catch {
    return null
  }
}

/**
 * Get full channel information including description, stats, and settings
 * This makes an additional API call to get ChannelFull
 */
export async function getChannelFullInfo(channelId: number): Promise<ChannelFullInfo | null> {
  const client = getTelegramClient()

  try {
    const chat = await client.getChat(channelId)
    if (chat.chatType !== 'channel' || isGroupChat(chat)) {
      return null
    }

    // Get basic channel info
    const baseChannel = mapChatToChannel(chat)

    // Get full channel info - construct InputChannel from chat raw data
    const raw = chat.raw
    if (raw._ !== 'channel' || !raw.accessHash) {
      return baseChannel
    }
    
    const fullResult = await client.call({
      _: 'channels.getFullChannel',
      channel: {
        _: 'inputChannel',
        channelId: raw.id,
        accessHash: raw.accessHash,
      },
    })

    // Extract full info from response
    const fullChat = fullResult.fullChat
    if (fullChat._ !== 'channelFull') {
      return baseChannel
    }

    // Get channel flags from raw (already have raw from above)
    const isVerified = raw._ === 'channel' && raw.verified === true
    const isScam = raw._ === 'channel' && raw.scam === true
    const isFake = raw._ === 'channel' && raw.fake === true
    const isProtected = raw._ === 'channel' && raw.noforwards === true

    return {
      ...baseChannel,
      description: fullChat.about || undefined,
      participantsCount: fullChat.participantsCount ?? baseChannel.participantsCount,
      onlineCount: fullChat.onlineCount ?? undefined,
      linkedChatId: fullChat.linkedChatId ?? undefined,
      inviteLink: fullChat.exportedInvite?._ === 'chatInviteExported'
        ? fullChat.exportedInvite.link
        : undefined,
      slowmodeSeconds: fullChat.slowmodeSeconds ?? undefined,
      isVerified,
      isScam,
      isFake,
      isProtected,
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[getChannelFullInfo] Failed:', error)
    }
    return null
  }
}

/**
 * Join a channel by username or invite link
 */
export async function joinChannel(usernameOrLink: string): Promise<Channel | null> {
  const client = getTelegramClient()

  try {
    // Handle invite links
    if (usernameOrLink.includes('t.me/+') || usernameOrLink.includes('joinchat/')) {
      const hash = extractInviteHash(usernameOrLink)
      if (hash) {
        const result = await client.call({
          _: 'messages.importChatInvite',
          hash,
        })
        if ('chats' in result && result.chats.length > 0) {
          const chat = result.chats[0]
          if (chat._ === 'channel') {
            return {
              id: chat.id,
              accessHash: BigInt(chat.accessHash?.toString() ?? '0'),
              title: chat.title,
              username: chat.username ?? undefined,
            }
          }
        }
      }
      return null
    }

    // Handle username
    const username = usernameOrLink.replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '')
    const chat = await client.getChat(username)
    if (chat.chatType === 'channel') {
      await client.joinChat(chat)
      return mapChatToChannel(chat)
    }
    return null
  } catch {
    return null
  }
}

/**
 * Leave a channel
 */
export async function leaveChannel(channelId: number): Promise<boolean> {
  const client = getTelegramClient()

  try {
    const chat = await client.getChat(channelId)
    if (chat.chatType === 'channel') {
      await client.leaveChat(chat)
      return true
    }
    return false
  } catch {
    return false
  }
}

// Helpers

/**
 * Check if a chat is a group (supergroup/megagroup) rather than a broadcast channel
 */
function isGroupChat(chat: Chat): boolean {
  // chatType 'supergroup' or 'gigagroup' means it's a group, not a broadcast channel
  return chat.chatType === 'supergroup' || chat.chatType === 'gigagroup'
}

/**
 * Map mtcute Chat to our Channel interface
 */
export function mapChatToChannel(chat: Chat): Channel {
  // Access accessHash from raw TL object if available
  const raw = chat.raw
  const accessHash = 'accessHash' in raw && raw.accessHash
    ? BigInt(raw.accessHash.toString())
    : BigInt(0)

  return {
    id: chat.id,
    accessHash,
    title: chat.title ?? 'Unknown',
    username: chat.username ?? undefined,
    participantsCount: chat.membersCount ?? undefined,
    linkedChatId: undefined, // Would need FullChat for this
  }
}

function extractInviteHash(link: string): string | null {
  const match = link.match(/(?:t\.me\/\+|joinchat\/)([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

/** Pagination limit for fetching archived dialogs (max supported by Telegram) */
const ARCHIVED_FETCH_LIMIT = 500

/**
 * Fetch all archived channel IDs using raw Telegram API
 * 
 * Telegram API bug: messages.getDialogs with folderId:0 sometimes returns
 * channels that are actually archived (folderId:1). mtcute's iterDialogs
 * passes folderId correctly, but Telegram server returns inconsistent data.
 * 
 * We fetch archived IDs separately and filter on client side as a workaround.
 */
export async function fetchArchivedChannelIds(): Promise<Set<number>> {
  const archivedIds = new Set<number>()
  
  try {
    const client = getTelegramClient()
    
    let offsetDate = 0
    let offsetId = 0
    let offsetPeer: tl.TypeInputPeer = { _: 'inputPeerEmpty' }
    let hasMore = true
    
    if (import.meta.env.DEV) {
      console.log('[Archived] Fetching archived channel IDs via raw API...')
    }
    
    while (hasMore) {
      const result = await client.call({
        _: 'messages.getDialogs',
        folderId: 1, // Archive folder
        offsetDate,
        offsetId,
        offsetPeer,
        limit: ARCHIVED_FETCH_LIMIT,
        hash: Long.ZERO,
      })
      
      // Check if we got valid response with dialogs
      if (!('dialogs' in result) || result.dialogs.length === 0) {
        hasMore = false
        break
      }
      
      // Extract channel IDs from dialogs where folderId === 1
      // (pinned dialogs have folderId: undefined and appear in BOTH folders)
      if ('chats' in result) {
        // Build set of channel IDs that are actually archived (folderId === 1)
        const archivedChannelIds = new Set<string>()
        for (const dialog of result.dialogs) {
          if (dialog._ === 'dialog' && dialog.folderId === 1) {
            const peer = dialog.peer
            if (peer._ === 'peerChannel') {
              archivedChannelIds.add(String(peer.channelId))
            }
          }
        }
        
        // Now add only those channels that are truly archived
        for (const chat of result.chats) {
          if (chat._ === 'channel' && !chat.megagroup && !chat.gigagroup) {
            if (archivedChannelIds.has(String(chat.id))) {
              const markedId = CHANNEL_ID_OFFSET - Number(chat.id)
              archivedIds.add(markedId)
            }
          }
        }
      }
      
      // Check if we got all dialogs (no more pages)
      if (result._ === 'messages.dialogs' || result.dialogs.length < ARCHIVED_FETCH_LIMIT) {
        hasMore = false
      } else if ('messages' in result && result.messages.length > 0) {
        // Get pagination offset from last message
        const lastMsg = result.messages[result.messages.length - 1]
        if (lastMsg._ === 'message' || lastMsg._ === 'messageService') {
          offsetDate = lastMsg.date
          offsetId = lastMsg.id
        }
        
        // Get peer from last dialog for offset
        const lastDialog = result.dialogs[result.dialogs.length - 1]
        if (lastDialog._ === 'dialog' && 'chats' in result && 'users' in result) {
          offsetPeer = buildOffsetPeer(lastDialog.peer, result.chats, result.users)
        }
      } else {
        hasMore = false
      }
    }
  } catch (error: unknown) {
    if (import.meta.env.DEV) {
      console.error('[Archived] Error fetching archived dialogs:', error)
    }
    // Return whatever we collected so far (graceful degradation)
  }
  
  if (import.meta.env.DEV) {
    console.log(`[Archived] Found ${archivedIds.size} archived channels`)
  }
  
  return archivedIds
}

/**
 * Build InputPeer for pagination offset from dialog peer
 */
function buildOffsetPeer(
  peer: tl.TypePeer,
  chats: tl.TypeChat[],
  users: tl.TypeUser[]
): tl.TypeInputPeer {
  if (peer._ === 'peerChannel') {
    const chat = chats.find(c => c._ === 'channel' && c.id === peer.channelId)
    if (chat && chat._ === 'channel' && chat.accessHash) {
      return {
        _: 'inputPeerChannel',
        channelId: chat.id,
        accessHash: Long.isLong(chat.accessHash) ? chat.accessHash : Long.fromValue(chat.accessHash),
      }
    }
  } else if (peer._ === 'peerChat') {
    return { _: 'inputPeerChat', chatId: peer.chatId }
  } else if (peer._ === 'peerUser') {
    const user = users.find(u => u._ === 'user' && u.id === peer.userId)
    if (user && user._ === 'user' && user.accessHash) {
      return {
        _: 'inputPeerUser',
        userId: user.id,
        accessHash: Long.isLong(user.accessHash) ? user.accessHash : Long.fromValue(user.accessHash),
      }
    }
  }
  
  // Fallback to empty peer (will restart from beginning, but better than crashing)
  return { _: 'inputPeerEmpty' }
}

/**
 * DEBUG: Check why LyMusic appears in archived list
 * Call from console: window.debugCheckLyMusic()
 */
export async function debugCheckLyMusic(): Promise<void> {
  const client = getTelegramClient()
  const TARGET_NAME = 'LyMusic'
  
  console.log('='.repeat(60))
  console.log(`[DEBUG] Checking "${TARGET_NAME}" in both folders`)
  console.log('='.repeat(60))
  
  // Check in folderId: 0 (main)
  console.log('\n[1] Checking folderId:0 (main)...')
  const mainResult = await client.call({
    _: 'messages.getDialogs',
    folderId: 0,
    offsetDate: 0,
    offsetId: 0,
    offsetPeer: { _: 'inputPeerEmpty' },
    limit: 100,
    hash: Long.ZERO,
  })
  
  if ('dialogs' in mainResult && 'chats' in mainResult) {
    for (const dialog of mainResult.dialogs) {
      if (dialog._ !== 'dialog') continue
      const peer = dialog.peer
      if (peer._ !== 'peerChannel') continue
      
      const chat = mainResult.chats.find(c => c._ === 'channel' && c.id === peer.channelId)
      if (chat && chat._ === 'channel' && chat.title.includes(TARGET_NAME)) {
        console.log(`[1] Found "${chat.title}" in folderId:0 response:`)
        console.log(`    dialog.folderId = ${dialog.folderId}`)
        console.log(`    dialog.pinned = ${dialog.pinned}`)
        console.log(`    Raw dialog:`, dialog)
      }
    }
  }
  
  // Check in folderId: 1 (archive)
  console.log('\n[2] Checking folderId:1 (archive)...')
  const archiveResult = await client.call({
    _: 'messages.getDialogs',
    folderId: 1,
    offsetDate: 0,
    offsetId: 0,
    offsetPeer: { _: 'inputPeerEmpty' },
    limit: 100,
    hash: Long.ZERO,
  })
  
  let foundInArchive = false
  if ('dialogs' in archiveResult && 'chats' in archiveResult) {
    for (const dialog of archiveResult.dialogs) {
      if (dialog._ !== 'dialog') continue
      const peer = dialog.peer
      if (peer._ !== 'peerChannel') continue
      
      const chat = archiveResult.chats.find(c => c._ === 'channel' && c.id === peer.channelId)
      if (chat && chat._ === 'channel' && chat.title.includes(TARGET_NAME)) {
        foundInArchive = true
        console.log(`[2] Found "${chat.title}" in folderId:1 response:`)
        console.log(`    dialog.folderId = ${dialog.folderId}`)
        console.log(`    dialog.pinned = ${dialog.pinned}`)
        console.log(`    Raw dialog:`, dialog)
      }
    }
  }
  
  if (!foundInArchive) {
    console.log(`[2] "${TARGET_NAME}" NOT found in folderId:1 response`)
  }
  
  // Check pinned dialogs
  console.log('\n[3] Checking pinned dialogs in main folder...')
  const pinnedResult = await client.call({
    _: 'messages.getPinnedDialogs',
    folderId: 0,
  })
  
  if ('dialogs' in pinnedResult && 'chats' in pinnedResult) {
    console.log(`[3] Total pinned dialogs: ${pinnedResult.dialogs.length}`)
    for (const dialog of pinnedResult.dialogs) {
      if (dialog._ !== 'dialog') continue
      const peer = dialog.peer
      if (peer._ !== 'peerChannel') continue
      
      const chat = pinnedResult.chats.find(c => c._ === 'channel' && c.id === peer.channelId)
      if (chat && chat._ === 'channel' && chat.title.includes(TARGET_NAME)) {
        console.log(`[3] Found "${chat.title}" in PINNED dialogs:`)
        console.log(`    dialog.folderId = ${dialog.folderId}`)
        console.log(`    dialog.pinned = ${dialog.pinned}`)
      }
    }
  }
  
  console.log('\n' + '='.repeat(60))
}

// Expose to window
if (typeof window !== 'undefined') {
  window.debugCheckLyMusic = debugCheckLyMusic
}

/**
 * DEBUG: Verify if Telegram API returns wrong folderId
 * Call from console: window.debugVerifyFolderId()
 */
export async function debugVerifyFolderId(): Promise<void> {
  const client = getTelegramClient()
  
  console.log('='.repeat(60))
  console.log('[DEBUG] Verifying folderId in Telegram API responses')
  console.log('='.repeat(60))
  
  // Step 1: Get archived IDs via raw API (folderId: 1) - use existing function with pagination
  console.log('\n[Step 1] Fetching from folderId:1 (archive) with pagination...')
  const archivedIds = await fetchArchivedChannelIds()
  console.log(`[Step 1] Found ${archivedIds.size} channels in archive`)
  
  // Step 2: Get dialogs from folderId:0 with pagination and check raw folderId
  console.log('\n[Step 2] Fetching from folderId:0 (main) with pagination...')
  
  const leaked: Array<{ id: number; title: string; rawFolderId: number | undefined }> = []
  let offsetDate = 0
  let offsetId = 0
  let offsetPeer: tl.TypeInputPeer = { _: 'inputPeerEmpty' }
  let hasMore = true
  let totalDialogs = 0
  
  while (hasMore && totalDialogs < 2000) {
    const mainResult = await client.call({
      _: 'messages.getDialogs',
      folderId: 0,
      offsetDate,
      offsetId,
      offsetPeer,
      limit: 100,
      hash: Long.ZERO,
    })
    
    if (!('dialogs' in mainResult) || mainResult.dialogs.length === 0) {
      hasMore = false
      break
    }
    
    totalDialogs += mainResult.dialogs.length
    
    if ('chats' in mainResult) {
      // Build map of chat id -> chat
      const chatMap = new Map<string, typeof mainResult.chats[0]>()
      for (const chat of mainResult.chats) {
        if ('id' in chat) {
          chatMap.set(String(chat.id), chat)
        }
      }
      
      // Check each dialog
      for (const dialog of mainResult.dialogs) {
        if (dialog._ !== 'dialog') continue
        
        const peer = dialog.peer
        if (peer._ !== 'peerChannel') continue
        
        const chat = chatMap.get(String(peer.channelId))
        if (!chat || chat._ !== 'channel') continue
        if (chat.megagroup || chat.gigagroup) continue
        
        const markedId = CHANNEL_ID_OFFSET - Number(chat.id)
        
        // Check if this channel is in our archived set
        if (archivedIds.has(markedId)) {
          leaked.push({
            id: markedId,
            title: chat.title,
            rawFolderId: dialog.folderId
          })
          console.log(`[Step 2] LEAKED: "${chat.title}" (${markedId})`)
          console.log(`         Raw dialog.folderId = ${dialog.folderId}`)
          console.log(`         API request folderId = 0`)
        }
      }
    }
    
    // Pagination
    if (mainResult._ === 'messages.dialogs' || mainResult.dialogs.length < 100) {
      hasMore = false
    } else if ('messages' in mainResult && mainResult.messages.length > 0) {
      const lastMsg = mainResult.messages[mainResult.messages.length - 1]
      if (lastMsg._ === 'message' || lastMsg._ === 'messageService') {
        offsetDate = lastMsg.date
        offsetId = lastMsg.id
      }
      const lastDialog = mainResult.dialogs[mainResult.dialogs.length - 1]
      if (lastDialog._ === 'dialog' && 'chats' in mainResult && 'users' in mainResult) {
        offsetPeer = buildOffsetPeer(lastDialog.peer, mainResult.chats, mainResult.users)
      }
    } else {
      hasMore = false
    }
  }
  
  console.log(`[Step 2] Total dialogs fetched: ${totalDialogs}`)
  
  console.log('\n' + '='.repeat(60))
  console.log('[RESULT]')
  console.log('='.repeat(60))
  
  if (leaked.length > 0) {
    console.log(`\n${leaked.length} archived channels leaked through folderId:0 request:\n`)
    for (const ch of leaked) {
      console.log(`  "${ch.title}"`)
      console.log(`    - Present in folderId:1 response: YES`)
      console.log(`    - Returned by folderId:0 request: YES`)
      console.log(`    - dialog.folderId in response: ${ch.rawFolderId}`)
      
      if (ch.rawFolderId === 0) {
        console.log(`    → BUG: Telegram API returns folderId:0 for archived channel!`)
      } else if (ch.rawFolderId === 1) {
        console.log(`    → BUG: Telegram API returns channel with folderId:1 in folderId:0 request!`)
      } else {
        console.log(`    → WEIRD: folderId is ${ch.rawFolderId}`)
      }
    }
  } else {
    console.log('\n✓ No leaked channels found')
  }
  
  console.log('\n' + '='.repeat(60))
}

// Expose to window for debugging
if (typeof window !== 'undefined') {
  window.debugVerifyFolderId = debugVerifyFolderId
}
