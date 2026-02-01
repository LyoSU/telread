import { getTelegramClient, waitForClientReady } from './client'
import { mapMessage } from './messages'
import { MAX_DIALOGS_TO_ITERATE } from '@/config/constants'
import type { Chat, Message as TgMessage } from '@mtcute/web'
import type { Message } from './messages'

export interface Channel {
  id: number
  accessHash: bigint
  title: string
  username?: string
  photo?: string
  participantsCount?: number
  description?: string
  linkedChatId?: number
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

  const iterator = client.iterDialogs()[Symbol.asyncIterator]()
  let dialogCount = 0
  let lastLogTime = startTime

  while (dialogCount < MAX_DIALOGS_TO_ITERATE) {
    try {
      const { value: dialog, done } = await iterator.next()
      if (done) break

      dialogCount++

      // Log progress every 100 dialogs or every 2 seconds
      if (import.meta.env.DEV && (dialogCount % 100 === 0 || performance.now() - lastLogTime > 2000)) {
        console.log(`[Channels] Processed ${dialogCount} dialogs, found ${channels.length} channels (${Math.round(performance.now() - startTime)}ms)`)
        lastLogTime = performance.now()
      }

      const peer = dialog.peer

      // Skip users and secret chats
      if (peer.type !== 'chat') continue
      const chat = peer as Chat
      if (chat.chatType === 'channel' && !isGroupChat(chat)) {
        const channel = mapChatToChannel(chat)

        // Extract lastMessage from dialog - KEY OPTIMIZATION
        // dialog.lastMessage is a high-level Message object from mtcute
        const lastMessage = dialog.lastMessage
        let mappedLastMessage: Message | undefined

        if (lastMessage) {
          try {
            const mapped = mapMessage(lastMessage as TgMessage, channel.id)
            if (mapped) {
              mappedLastMessage = mapped
              
              // Track if this message is part of a group (album)
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
    console.log(`[Channels] Done! ${dialogCount} dialogs → ${channels.length} channels in ${Math.round(performance.now() - startTime)}ms`)
  }

  // Fetch complete groups for messages that are part of albums
  const groupedPosts: Message[] = []
  
  if (groupedMessages.length > 0) {
    if (import.meta.env.DEV) {
      console.log(`[Channels] Fetching ${groupedMessages.length} media groups...`)
    }

    // Collect existing IDs to avoid duplicates
    const existingIds = new Set(
      channels.map((c) => c.lastMessage ? `${c.lastMessage.channelId}:${c.lastMessage.id}` : null).filter(Boolean)
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
