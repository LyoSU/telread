/**
 * Open Chats Management
 * 
 * MTProto requires calling openChat() on channels to receive consistent updates.
 * Without this, updates may be delayed or missed entirely.
 * 
 * From mtcute docs:
 * > For Telegram to properly send updates for channels, you need to open them first.
 * > Avoid opening more than 5-10 chats at once.
 * 
 * This module manages which channels are "open" for real-time updates.
 * It uses visibility tracking to prioritize channels the user is currently viewing.
 */
import { getTelegramClient, isClientReady } from './client'
import { isChannelInvalid } from './errors'
import { getTime } from '@/lib/utils'

/**
 * Maximum channels to keep open at once
 * mtcute recommends 5-10, we use 8 as a safe middle ground
 */
const MAX_OPEN_CHATS = 8

/**
 * Set of currently open channel IDs
 */
const openChannels = new Set<number>()

/**
 * Channels currently being opened (to prevent TOCTOU race)
 */
const pendingOpens = new Set<number>()

/**
 * Whether the open chats system is active
 */
let isActive = false

/**
 * Open a channel to receive real-time updates
 * 
 * This tells Telegram to send updates for this channel.
 * Without calling this, updates may be delayed or missed.
 * 
 * Uses pendingOpens to prevent TOCTOU race condition when called concurrently.
 */
export async function openChannel(channelId: number): Promise<boolean> {
  if (!isClientReady()) {
    if (import.meta.env.DEV) {
      console.log('[OpenChats] Client not ready, skipping openChat for', channelId)
    }
    return false
  }

  // Already open
  if (openChannels.has(channelId)) {
    return true
  }
  
  // Already being opened (prevents TOCTOU race)
  if (pendingOpens.has(channelId)) {
    return true
  }

  // Check if we're at capacity (count both open and pending)
  if (openChannels.size + pendingOpens.size >= MAX_OPEN_CHATS) {
    if (import.meta.env.DEV) {
      console.log('[OpenChats] At capacity, cannot open', channelId)
    }
    return false
  }

  // Mark as pending before async operation
  pendingOpens.add(channelId)
  
  const client = getTelegramClient()

  try {
    // Resolve peer first to ensure it's in the client's cache with access_hash
    // Without this, openChat may fail with CHANNEL_INVALID for channels not in cache
    const peer = await client.resolvePeer(channelId)
    await client.openChat(peer)
    openChannels.add(channelId)
    
    if (import.meta.env.DEV) {
      console.log(`[OpenChats] Opened channel ${channelId}, total open: ${openChannels.size}`)
    }
    return true
  } catch (error) {
    // Silently ignore invalid/inaccessible channels - they may have been deleted
    // or user may have left them
    if (!isChannelInvalid(error) && import.meta.env.DEV) {
      console.warn(`[OpenChats] Failed to open channel ${channelId}:`, error)
    }
    return false
  } finally {
    pendingOpens.delete(channelId)
  }
}

/**
 * Close a channel to stop receiving prioritized updates
 */
export async function closeChannel(channelId: number): Promise<void> {
  if (!openChannels.has(channelId)) {
    return // Not open
  }

  const client = getTelegramClient()

  try {
    await client.closeChat(channelId)
    openChannels.delete(channelId)
    
    if (import.meta.env.DEV) {
      console.log(`[OpenChats] Closed channel ${channelId}, total open: ${openChannels.size}`)
    }
  } catch (error) {
    // Still remove from set even if close fails
    openChannels.delete(channelId)
    
    if (import.meta.env.DEV) {
      console.warn(`[OpenChats] Error closing channel ${channelId}:`, error)
    }
  }
}

/**
 * Close all open channels
 */
export async function closeAllChannels(): Promise<void> {
  const channelsToClose = [...openChannels]
  
  if (import.meta.env.DEV && channelsToClose.length > 0) {
    console.log(`[OpenChats] Closing all ${channelsToClose.length} channels`)
  }

  // Close in parallel for speed
  await Promise.allSettled(channelsToClose.map(closeChannel))
  
  openChannels.clear()
  isActive = false
}

/**
 * Update which channels are open based on activity
 * 
 * Opens the most recently active channels (by lastMessage date)
 * and closes channels that are no longer in the top list.
 * 
 * @param channels - Array of channels with lastMessage, sorted by activity
 */
export async function updateOpenChannels(
  channels: Array<{ id: number; lastMessage?: { date: Date | string } }>
): Promise<void> {
  if (!isClientReady()) {
    if (import.meta.env.DEV) {
      console.log('[OpenChats] Client not ready, deferring updateOpenChannels')
    }
    return
  }

  isActive = true

  // Sort by last message date (most recent first) and take top N
  const sortedChannels = [...channels]
    .filter(c => c.lastMessage)
    .sort((a, b) => {
      const aTime = a.lastMessage?.date ? getTime(a.lastMessage.date) : 0
      const bTime = b.lastMessage?.date ? getTime(b.lastMessage.date) : 0
      return bTime - aTime
    })
    .slice(0, MAX_OPEN_CHATS)

  const targetChannelIds = new Set(sortedChannels.map(c => c.id))

  // Close channels that are no longer in top list
  const channelsToClose = [...openChannels].filter(id => !targetChannelIds.has(id))
  
  // Open new channels
  const channelsToOpen = sortedChannels.filter(c => !openChannels.has(c.id))

  if (import.meta.env.DEV && (channelsToClose.length > 0 || channelsToOpen.length > 0)) {
    console.log(`[OpenChats] Updating: closing ${channelsToClose.length}, opening ${channelsToOpen.length}`)
  }

  // Close old channels first to make room
  await Promise.allSettled(channelsToClose.map(closeChannel))

  // Open new channels with small delay between to avoid rate limits
  for (const channel of channelsToOpen) {
    await openChannel(channel.id)
    // Small delay to be safe with rate limits
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  if (import.meta.env.DEV) {
    console.log(`[OpenChats] Update complete, ${openChannels.size} channels open`)
  }
}

