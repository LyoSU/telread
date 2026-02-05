/**
 * Centralized channels store
 * 
 * Single source of truth for all channel metadata.
 * Channels are added:
 * - On initial load from fetchChannelsWithLastMessages
 * - Dynamically when posts arrive from unknown channels (via real-time updates)
 * - Restored from persistent cache on page reload
 * 
 * Persistence: dynamically discovered channels are saved to IndexedDB
 * via TanStack Query persister to survive page reloads.
 */
import { createStore, produce } from 'solid-js/store'
import { createMemo } from 'solid-js'
import type { ChannelWithLastMessage } from '@/lib/telegram'
import { queryClient, queryKeys } from '@/lib/query'

interface SyncedChannelsData {
  channels: ChannelWithLastMessage[]
}

interface ArchivedIdsData {
  ids: number[]
}

// Re-export for convenience
export type { ChannelWithLastMessage }

interface ChannelsState {
  byId: Record<number, ChannelWithLastMessage>
  ids: number[]
  /** IDs of channels in the Archive folder (for filtering) */
  archivedIds: Set<number>
}

const [state, setState] = createStore<ChannelsState>({
  byId: {},
  ids: [],
  archivedIds: new Set(),
})

/**
 * Set all channels (initial load)
 */
export function setChannels(channels: ChannelWithLastMessage[]): void {
  setState(produce((s) => {
    s.byId = {}
    s.ids = []
    for (const channel of channels) {
      s.byId[channel.id] = channel
      s.ids.push(channel.id)
    }
  }))

  if (import.meta.env.DEV) {
    console.log(`[Channels] Set ${channels.length} channels`)
  }
}

/**
 * Add or update a single channel
 * Used when a post arrives from an unknown channel
 * Automatically persists to IndexedDB for page reload survival
 */
export function upsertChannel(channel: ChannelWithLastMessage): void {
  let isNew = false

  setState(produce((s) => {
    const existing = s.byId[channel.id]
    if (!existing) {
      s.ids.push(channel.id)
      isNew = true
      if (import.meta.env.DEV) {
        console.log(`[Channels] Added new channel: ${channel.id} "${channel.title}"`)
      }
    }
    s.byId[channel.id] = channel
  }))

  // Persist dynamically discovered channels to IndexedDB
  if (isNew) {
    persistChannelToCache(channel)
  }
}

/**
 * Persist a dynamically discovered channel to IndexedDB cache
 */
function persistChannelToCache(channel: ChannelWithLastMessage): void {
  queryClient.setQueryData<SyncedChannelsData>(queryKeys.timeline.syncedChannels, (old) => {
    const existing = old?.channels ?? []

    // Skip if already cached
    if (existing.some(c => c.id === channel.id)) {
      return old
    }

    const newChannels = [...existing, channel]

    if (import.meta.env.DEV) {
      console.log(`[Channels] Persisted to cache: ${channel.id} "${channel.title}", total cached: ${newChannels.length}`)
    }

    return { channels: newChannels }
  })
}

/**
 * Restore dynamically discovered channels from IndexedDB cache
 * Called on app startup after initial channels are loaded
 */
export function restoreChannelsFromCache(): void {
  try {
    const data = queryClient.getQueryData<SyncedChannelsData>(queryKeys.timeline.syncedChannels)
    const cachedChannels = data?.channels
    
    // Validate cached data
    if (!Array.isArray(cachedChannels) || cachedChannels.length === 0) return

    let restoredCount = 0

    setState(produce((s) => {
      for (const channel of cachedChannels) {
        // Validate channel structure before using
        if (!channel || typeof channel.id !== 'number' || !Number.isFinite(channel.id)) {
          continue
        }
        // Only add if not already present (from initial load)
        if (!s.byId[channel.id]) {
          s.byId[channel.id] = channel
          s.ids.push(channel.id)
          restoredCount++
        }
      }
    }))

    if (import.meta.env.DEV && restoredCount > 0) {
      console.log(`[Channels] Restored ${restoredCount} channels from cache`)
    }
  } catch (error: unknown) {
    if (import.meta.env.DEV) {
      console.error('[Channels] Failed to restore channels from cache:', error)
    }
    // Graceful degradation - continue without cached data
  }
}

/**
 * Check if channel exists
 */
export function hasChannel(channelId: number): boolean {
  return !!state.byId[channelId]
}

/**
 * Get channel by ID
 */
export function getChannel(channelId: number): ChannelWithLastMessage | undefined {
  return state.byId[channelId]
}

/**
 * Get channel by username (case-insensitive)
 * Used for instant resolve when navigating via username URL
 */
export function getChannelByUsername(username: string): ChannelWithLastMessage | undefined {
  const lowerUsername = username.toLowerCase()
  for (const id of state.ids) {
    const channel = state.byId[id]
    if (channel?.username?.toLowerCase() === lowerUsername) {
      return channel
    }
  }
  return undefined
}

/**
 * Get all channels as array (reactive)
 */
export function getChannels(): ChannelWithLastMessage[] {
  return state.ids.map(id => state.byId[id]).filter(Boolean)
}

/**
 * Reactive channel map for efficient lookups
 */
export function createChannelMap() {
  return createMemo(() => {
    const map = new Map<number, ChannelWithLastMessage>()
    for (const id of state.ids) {
      const channel = state.byId[id]
      if (channel) map.set(id, channel)
    }
    return map
  })
}

/**
 * Set archived channel IDs (fetched via raw API)
 * Also persists to IndexedDB for instant startup
 */
export function setArchivedChannelIds(ids: Set<number>): void {
  setState('archivedIds', ids)
  
  // Persist to IndexedDB
  queryClient.setQueryData<ArchivedIdsData>(queryKeys.timeline.archivedChannelIds, {
    ids: Array.from(ids)
  })
  
  if (import.meta.env.DEV) {
    console.log(`[Channels] Set ${ids.size} archived channel IDs (persisted)`)
  }
}

/**
 * Add a channel to archived set (when receiving updateFolderPeers)
 */
export function addArchivedChannelId(channelId: number): void {
  if (state.archivedIds.has(channelId)) return
  
  const newSet = new Set(state.archivedIds)
  newSet.add(channelId)
  setState('archivedIds', newSet)
  
  // Update persistent cache
  queryClient.setQueryData<ArchivedIdsData>(queryKeys.timeline.archivedChannelIds, {
    ids: Array.from(newSet)
  })
  
  if (import.meta.env.DEV) {
    console.log(`[Channels] Added ${channelId} to archived`)
  }
}

/**
 * Remove a channel from archived set (when receiving updateFolderPeers)
 */
export function removeArchivedChannelId(channelId: number): void {
  if (!state.archivedIds.has(channelId)) return
  
  const newSet = new Set(state.archivedIds)
  newSet.delete(channelId)
  setState('archivedIds', newSet)
  
  // Update persistent cache
  queryClient.setQueryData<ArchivedIdsData>(queryKeys.timeline.archivedChannelIds, {
    ids: Array.from(newSet)
  })
  
  if (import.meta.env.DEV) {
    console.log(`[Channels] Removed ${channelId} from archived`)
  }
}

/**
 * Restore archived channel IDs from IndexedDB cache
 * Called on app startup for instant filtering
 */
export function restoreArchivedIdsFromCache(): void {
  try {
    const data = queryClient.getQueryData<ArchivedIdsData>(queryKeys.timeline.archivedChannelIds)
    
    // Validate cached data
    if (!data?.ids || !Array.isArray(data.ids)) return
    
    // Filter to valid numbers only (protection against corrupted cache)
    const validIds = data.ids.filter(id => typeof id === 'number' && Number.isFinite(id))
    if (validIds.length === 0) return
    
    setState('archivedIds', new Set(validIds))
    
    if (import.meta.env.DEV) {
      console.log(`[Channels] Restored ${validIds.length} archived IDs from cache`)
    }
  } catch (error: unknown) {
    if (import.meta.env.DEV) {
      console.error('[Channels] Failed to restore archived IDs from cache:', error)
    }
    // Graceful degradation - continue without cached data
  }
}

/**
 * Check if a channel is in the Archive folder
 */
export function isChannelArchived(channelId: number): boolean {
  return state.archivedIds.has(channelId)
}

/**
 * Get the Set of archived channel IDs
 */
export function getArchivedChannelIds(): Set<number> {
  return state.archivedIds
}

/**
 * Export state for reactive access
 */
export const channelsState = state
