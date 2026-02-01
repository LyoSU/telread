import { createQuery, createInfiniteQuery } from '@tanstack/solid-query'
import { createEffect, on, createMemo, onCleanup } from 'solid-js'
import {
  fetchMessages,
  fetchChannelsWithLastMessages,
  onTimelineLoaded,
  sliceWithCompleteGroups,
  updateOpenChannels,
  closeAllChannels,
  type Message,
  type ChannelWithLastMessage,
} from '@/lib/telegram'
import {
  upsertPosts,
  postsState,
  markStoreInitialized,
  revealPendingPosts,
  setChannels,
  getChannels,
  createChannelMap,
  restoreChannelsFromCache,
  folderStore,
  startActivityTracking,
  getLastActiveDescription,
} from '@/lib/store'
import { getTime, groupPostsByMediaGroup } from '@/lib/utils'
import { queryKeys } from '../keys'
import { queryClient } from '../client'

/**
 * Hook to fetch messages from a single channel
 * 
 * Simple and clean - just TanStack Query with postsState sync for timeline integration
 */
export function useMessages(channelId: () => number, enabled?: () => boolean) {
  const query = createQuery(() => ({
    queryKey: queryKeys.messages.list(channelId()),
    queryFn: async () => {
      const messages = await fetchMessages(channelId(), { limit: 50 })
      // Sync to centralized store for timeline
      upsertPosts(messages)
      return messages
    },
    enabled: (enabled?.() ?? true) && channelId() !== 0,
    staleTime: 1000 * 60 * 5, // 5 min
  }))

  // Sync cached data to postsState on restore
  createEffect(
    on(() => query.data, (data) => {
      if (data?.length) upsertPosts(data)
    }, { defer: false })
  )

  return query
}

/**
 * Hook for infinite scrolling messages from a channel
 */
export function useInfiniteMessages(channelId: () => number) {
  const query = createInfiniteQuery(() => ({
    queryKey: queryKeys.messages.infinite(channelId()),
    queryFn: async ({ pageParam }) => {
      const messages = await fetchMessages(channelId(), {
        limit: 20,
        offsetId: pageParam,
      })
      upsertPosts(messages)
      return messages
    },
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < 20) return undefined
      return lastPage[lastPage.length - 1]?.id
    },
    enabled: channelId() !== 0,
    staleTime: 1000 * 60 * 5,
  }))

  // Sync cached pages to postsState
  createEffect(
    on(() => query.data?.pages, (pages) => {
      if (pages?.length) upsertPosts(pages.flat())
    }, { defer: false })
  )

  return query
}

/**
 * Timeline data structure - channels and grouped posts
 * Note: channelMap is derived in useOptimizedTimeline via createMemo
 */
export interface TimelineData {
  channels: ChannelWithLastMessage[]
  /** Additional posts from media groups (albums) */
  groupedPosts: Message[]
}

/**
 * Maximum posts to persist in IndexedDB
 * Large for offline reading and history browsing
 * ~5000 posts * ~2KB = ~10MB (acceptable for IndexedDB)
 */
const MAX_SYNCED_POSTS = 5000

/**
 * Type for synced posts storage
 */
interface SyncedPostsData {
  posts: Message[]
}

// ============================================================================
// Batched Persistent Cache Updates
// ============================================================================

const pendingPersistPosts: Message[] = []
let persistTimer: ReturnType<typeof setTimeout> | null = null
const PERSIST_DEBOUNCE_MS = 1000 // Debounce writes to IndexedDB

// Flush pending posts before page unload to prevent data loss
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (pendingPersistPosts.length > 0) {
      flushPersistentCache()
    }
  })
}

function flushPersistentCache(): void {
  if (pendingPersistPosts.length === 0) return

  const postsToAdd = [...pendingPersistPosts]
  pendingPersistPosts.length = 0
  persistTimer = null

  queryClient.setQueryData<SyncedPostsData>(queryKeys.timeline.syncedPosts, (old) => {
    const existingPosts = old?.posts ?? []

    // Create a map of existing posts by key for deduplication
    const postsMap = new Map<string, Message>()
    for (const post of existingPosts) {
      postsMap.set(`${post.channelId}:${post.id}`, post)
    }

    // Add/update with new posts (newer wins)
    for (const post of postsToAdd) {
      const key = `${post.channelId}:${post.id}`
      const existing = postsMap.get(key)

      if (!existing) {
        postsMap.set(key, post)
      } else {
        // Only update if newer
        const existingTime = getTime(existing.editDate ?? existing.date)
        const newTime = getTime(post.editDate ?? post.date)
        if (newTime > existingTime) {
          postsMap.set(key, post)
        }
      }
    }

    // Convert back to array and sort by date (newest first)
    const allPosts = Array.from(postsMap.values())
      .sort((a, b) => getTime(b.date) - getTime(a.date))
      .slice(0, MAX_SYNCED_POSTS)

    if (import.meta.env.DEV) {
      console.log(`[Timeline] Persisted ${postsToAdd.length} posts, total in cache: ${allPosts.length}`)
    }

    return { posts: allPosts }
  })
}

/**
 * Queue posts for persistent cache (debounced to avoid frequent IndexedDB writes)
 */
function queuePostsForPersistence(posts: Message[]): void {
  if (posts.length === 0) return

  pendingPersistPosts.push(...posts)

  if (!persistTimer) {
    persistTimer = setTimeout(flushPersistentCache, PERSIST_DEBOUNCE_MS)
  }
}

/**
 * Remove posts from persistent cache
 */
function removePostsFromPersistentCache(channelId: number, messageIds: number[]): void {
  const keysToRemove = new Set(messageIds.map(id => `${channelId}:${id}`))

  // Also remove from pending queue
  for (let i = pendingPersistPosts.length - 1; i >= 0; i--) {
    const post = pendingPersistPosts[i]
    if (keysToRemove.has(`${post.channelId}:${post.id}`)) {
      pendingPersistPosts.splice(i, 1)
    }
  }

  queryClient.setQueryData<SyncedPostsData>(queryKeys.timeline.syncedPosts, (old) => {
    if (!old) return old

    const filteredPosts = old.posts.filter(
      post => !keysToRemove.has(`${post.channelId}:${post.id}`)
    )

    if (filteredPosts.length === old.posts.length) return old
    return { posts: filteredPosts }
  })
}

/**
 * Get synced posts from persistent cache (for restore on page load)
 */
function getSyncedPostsFromCache(): Message[] {
  const data = queryClient.getQueryData<SyncedPostsData>(queryKeys.timeline.syncedPosts)
  return data?.posts ?? []
}

/**
 * Add single post to cache (convenience wrapper)
 */
export function addPostToCache(post: Message): void {
  addPostsToCache([post])
}

/**
 * Add multiple posts to cache - batched for efficiency
 * Updates channel lastMessages and queues for persistent storage
 */
export function addPostsToCache(posts: Message[]): void {
  if (posts.length === 0) return

  // Queue for persistent cache (debounced)
  queuePostsForPersistence(posts)

  // Update channels' lastMessage in timeline data (immediate)
  queryClient.setQueryData<TimelineData>(queryKeys.timeline.all, (old) => {
    if (!old) return old

    // Build a map of newest post per channel
    const newestByChannel = new Map<number, Message>()
    for (const post of posts) {
      const existing = newestByChannel.get(post.channelId)
      if (!existing || getTime(post.date) > getTime(existing.date)) {
        newestByChannel.set(post.channelId, post)
      }
    }

    let hasChange = false
    const newChannels = old.channels.map((channel) => {
      const newestPost = newestByChannel.get(channel.id)
      if (!newestPost) return channel

      const postTime = getTime(newestPost.editDate ?? newestPost.date)
      const currentTime = channel.lastMessage
        ? getTime(channel.lastMessage.editDate ?? channel.lastMessage.date)
        : 0

      if (postTime > currentTime) {
        hasChange = true
        return { ...channel, lastMessage: newestPost }
      }
      return channel
    })

    return hasChange ? { ...old, channels: newChannels } : old
  })
}

/**
 * Update channel's lastMessage when posts are deleted
 */
export function removePostsFromCache(channelId: number, messageIds: number[]): void {
  // Remove from persistent cache
  removePostsFromPersistentCache(channelId, messageIds)

  // Update timeline data
  queryClient.setQueryData<TimelineData>(queryKeys.timeline.all, (old) => {
    if (!old) return old

    const idsSet = new Set(messageIds)

    // Clear channel.lastMessage if it was deleted
    let hasChange = false
    const newChannels = old.channels.map((channel) => {
      if (channel.id !== channelId) return channel
      if (!channel.lastMessage) return channel

      if (idsSet.has(channel.lastMessage.id)) {
        hasChange = true
        // Set to undefined - we don't have a replacement readily available
        return { ...channel, lastMessage: undefined }
      }
      return channel
    })

    return hasChange ? { ...old, channels: newChannels } : old
  })
}

/**
 * Fetch initial timeline data - channels with their last messages
 * Posts are extracted in the effect (works for both fresh fetch and cache restore)
 */
async function fetchInitialTimeline(): Promise<TimelineData> {
  const startTime = performance.now()
  if (import.meta.env.DEV) {
    console.log('[Timeline] fetchInitialTimeline starting...')
  }

  const { channels, groupedPosts } = await fetchChannelsWithLastMessages()

  if (import.meta.env.DEV) {
    const postCount = channels.filter((c) => c.lastMessage).length
    console.log(`[Timeline] fetchInitialTimeline done: ${channels.length} channels, ${postCount} posts, ${groupedPosts.length} grouped posts in ${Math.round(performance.now() - startTime)}ms`)
  }

  return { channels, groupedPosts }
}

/**
 * Fetch more history for lazy loading
 */
async function fetchTimelineHistory(
  channelIds: number[],
  maxId: number,
  limit: number = 20
): Promise<Message[]> {
  // Limit parallel requests to avoid FLOOD_WAIT
  // User-triggered so some parallelism is okay, but keep it conservative
  const channelsToFetch = channelIds.slice(0, 2)
  const messagesPerChannel = Math.ceil(limit / channelsToFetch.length)

  const allMessages: Message[] = []

  // Fetch sequentially with small delay to be safe
  for (const channelId of channelsToFetch) {
    try {
      const messages = await fetchMessages(channelId, { limit: messagesPerChannel, maxId })
      allMessages.push(...messages)
    } catch {
      // Skip failed channels
      continue
    }
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  const sorted = allMessages.sort((a, b) => getTime(b.date) - getTime(a.date))
  return sliceWithCompleteGroups(sorted, limit)
}

/**
 * Light background sync: fetch recent messages from TOP channels only
 * 
 * Minimal sync - just top 10 most active channels, 3 messages each
 * Real-time updates (mtcute catchUp) handle the rest
 * 
 * Why this is enough:
 * - fetchChannelsWithLastMessages() already gets latest post per channel (1 API call)
 * - mtcute catchUp fetches missed updates automatically
 * - This just fills in a few more posts for better UX
 * 
 * Posts are saved to both RAM store AND persistent cache (IndexedDB)
 */
async function backgroundSyncRecentHistory(channels: ChannelWithLastMessage[]): Promise<void> {
  if (channels.length === 0) return

  const TOP_CHANNELS = 10
  const MESSAGES_PER_CHANNEL = 3

  const sortedChannels = [...channels]
    .filter(c => c.lastMessage)
    .sort((a, b) => getTime(b.lastMessage!.date) - getTime(a.lastMessage!.date))
    .slice(0, TOP_CHANNELS)

  if (import.meta.env.DEV) {
    const lastActive = getLastActiveDescription()
    console.log(`[Timeline] Background sync: ${sortedChannels.length} channels × ${MESSAGES_PER_CHANNEL} msgs (last active: ${lastActive})`)
  }

  const allMessages: Message[] = []

  for (const channel of sortedChannels) {
    try {
      const messages = await fetchMessages(channel.id, { limit: MESSAGES_PER_CHANNEL })
      allMessages.push(...messages)
    } catch {
      continue
    }
    await new Promise(resolve => setTimeout(resolve, 300))
  }

  if (allMessages.length > 0) {
    // Add to RAM store (for immediate UI)
    upsertPosts(allMessages)
    // Queue for persistent cache (survives page reload)
    queuePostsForPersistence(allMessages)

    if (import.meta.env.DEV) {
      console.log(`[Timeline] Background sync complete: ${allMessages.length} posts`)
    }
  }
}

/**
 * Optimized timeline hook
 *
 * Uses centralized posts store as single source of truth.
 * TanStack Query handles fetching, store handles state.
 * On app open: shows cached data instantly, then syncs fresh data in background.
 */
export function useOptimizedTimeline() {
  // Use global channels store
  const channelMap = createChannelMap()

  // Initial data query - fetches channels and populates posts store
  // Long staleTime because channels rarely change - real-time updates handle new posts
  const initialQuery = createQuery(() => ({
    queryKey: queryKeys.timeline.all,
    queryFn: fetchInitialTimeline,
    staleTime: 1000 * 60 * 30, // 30 min - channels list rarely changes
    gcTime: 1000 * 60 * 60, // 1 hour in memory
    refetchOnMount: false, // Don't refetch if data exists
    refetchOnWindowFocus: false,
  }))

  // Infinite query for loading more
  const historyQuery = createInfiniteQuery(() => ({
    // Add folder ID to key so query resets when folder changes
    queryKey: [...queryKeys.timeline.infinite(), folderStore.selectedFolderId],
    queryFn: async ({ pageParam }) => {
      let ids: number[] = []

      // If folder selected, fetch history ONLY for that folder's channels
      if (folderStore.selectedFolderId !== null) {
        ids = folderStore.channelIdsInFolder
      } else {
        // Otherwise, use the initial dialog list
        ids = initialQuery.data?.channels.map((c) => c.id) ?? []
      }

      if (ids.length === 0) return []
      return fetchTimelineHistory(ids, pageParam, 20)
    },
    initialPageParam: 0 as number,
    getNextPageParam: (lastPage) => {
      if (lastPage.length === 0) return undefined
      const oldest = lastPage.reduce((min, msg) => (msg.id < min.id ? msg : min), lastPage[0])
      return oldest.id
    },
    // Enable if we have channels to fetch from
    enabled: !!initialQuery.data?.channels || (folderStore.selectedFolderId !== null && folderStore.channelIdsInFolder.length > 0),
    staleTime: 1000 * 60 * 5,
  }))

  // Populate stores when data loads (from cache or fresh fetch)
  let hasInitialized = false
  createEffect(
    on(
      () => initialQuery.data,
      (data) => {
        if (!data) return

        // Sync channels to global store
        setChannels(data.channels)

        // Restore dynamically discovered channels from persistent cache
        restoreChannelsFromCache()

        // Always extract and upsert posts from channels
        // upsertPosts handles duplicates (only updates if newer)
        const lastMessages = data.channels
          .filter((c) => c.lastMessage)
          .map((c) => c.lastMessage!)

        // Include grouped posts (complete albums) from initial fetch
        const groupedPosts = data.groupedPosts ?? []

        // Also restore synced posts from persistent cache (survives page reload)
        const syncedPosts = getSyncedPostsFromCache()
        const allPosts = [...lastMessages, ...groupedPosts, ...syncedPosts]

        if (import.meta.env.DEV) {
          console.log(`[Timeline] Restoring: ${lastMessages.length} from lastMessage, ${groupedPosts.length} from groups, ${syncedPosts.length} from persistent cache`)
        }

        if (allPosts.length > 0) {
          upsertPosts(allPosts)
        }

        // Only run initialization once
        if (!hasInitialized) {
          hasInitialized = true
          markStoreInitialized()
          // Process messages that arrived before timeline was ready
          onTimelineLoaded()

          // Open top channels for real-time updates (MTProto requirement)
          // This is critical for receiving consistent updates
          updateOpenChannels(data.channels).catch((error) => {
            if (import.meta.env.DEV) {
              console.warn('[Timeline] Failed to open channels:', error)
            }
          })
        }
      }
    )
  )

  // Cleanup: close all open channels when component unmounts
  onCleanup(() => {
    closeAllChannels().catch(() => {
      // Ignore errors during cleanup
    })
  })
  
  // Start activity tracking (updates lastActive timestamp periodically)
  // This is used to determine sync strategy on next app start
  const stopActivityTracking = startActivityTracking()
  onCleanup(stopActivityTracking)

  // Populate posts from history pages (from cache or after scroll fetch)
  // Track processed page count to avoid re-processing
  let lastProcessedPageCount = 0
  createEffect(
    on(
      () => historyQuery.data?.pages,
      (pages) => {
        if (!pages || pages.length === 0) return
        // Only process new pages
        if (pages.length <= lastProcessedPageCount) return

        if (import.meta.env.DEV) {
          console.log(`[Timeline] History pages: ${lastProcessedPageCount} -> ${pages.length}, total posts: ${pages.flat().length}`)
        }
        lastProcessedPageCount = pages.length

        const posts = pages.flat()
        if (posts.length > 0) {
          upsertPosts(posts)
        }
      }
    )
  )

  // Light background sync: runs ONCE per session
  // Only syncs top 10 channels with 3 messages each (30 total max)
  let hasSynced = false
  createEffect(
    on(
      () => initialQuery.data,
      (data) => {
        if (!data || hasSynced) return
        hasSynced = true

        // Delay to let getDifference/catchUp complete first
        const timeoutId = setTimeout(() => {
          backgroundSyncRecentHistory(data.channels)
        }, 2000)

        // Cleanup if component unmounts before timeout fires
        onCleanup(() => clearTimeout(timeoutId))
      }
    )
  )

  // Reactive timeline from centralized store
  // Tracks both sortedKeys AND individual post changes (for edits, reactions)
  // FOLDER FILTERING: Only show posts from channels in the selected folder
  const timeline = createMemo(() => {
    const keys = postsState.sortedKeys
    let posts = keys.map((key) => postsState.byId[key]).filter(Boolean) as Message[]

    const folderId = folderStore.selectedFolderId
    const folderChannelIds = folderStore.channelIdsInFolder

    // Filter by folder if one is selected
    if (folderId !== null && folderChannelIds.length > 0) {
      const allowedChannelIds = new Set(folderChannelIds)
      const beforeFilter = posts.length
      posts = posts.filter(post => allowedChannelIds.has(post.channelId))

      if (import.meta.env.DEV) {
        console.log(`[Timeline] Folder filter: ${beforeFilter} posts → ${posts.length} posts`)
        console.log(`[Timeline] Folder ${folderId} has channels:`, Array.from(allowedChannelIds))
        if (posts.length === 0 && beforeFilter > 0) {
          const postChannels = new Set(keys.map(k => postsState.byId[k]?.channelId).filter(Boolean))
          console.log(`[Timeline] Available post channels:`, Array.from(postChannels))
        }
      }
    }

    // Group posts by groupedId for albums
    return groupPostsByMediaGroup(posts)
  })

  // Pending count - grouped by media group for accurate count
  // FOLDER FILTERING: Only count pending posts from channels in the selected folder
  const pendingCount = createMemo(() => {
    const keys = postsState.pendingKeys
    if (keys.length === 0) return 0
    let posts = keys.map((key) => postsState.byId[key]).filter(Boolean) as Message[]

    // Filter by folder if one is selected
    if (folderStore.selectedFolderId !== null && folderStore.channelIdsInFolder.length > 0) {
      const allowedChannelIds = new Set(folderStore.channelIdsInFolder)
      posts = posts.filter(post => allowedChannelIds.has(post.channelId))
    }

    return groupPostsByMediaGroup(posts).length
  })

  // Filtered channels based on selected folder
  const filteredChannels = createMemo(() => {
    const allChannels = getChannels()

    // If no folder selected, return all channels
    if (folderStore.selectedFolderId === null) {
      return allChannels
    }

    // Filter channels by folder
    if (folderStore.channelIdsInFolder.length === 0) {
      return []
    }

    const allowedChannelIds = new Set(folderStore.channelIdsInFolder)
    return allChannels.filter(channel => allowedChannelIds.has(channel.id))
  })

  return {
    get timeline() {
      return timeline()
    },
    get channels() {
      return filteredChannels()
    },
    /** Get all channels (unfiltered) - useful for folder calculations */
    get allChannels() {
      return getChannels()
    },
    get channelMap() {
      return channelMap()
    },
    get isLoading() {
      // Show loading until store is initialized (even if empty) or errored
      if (postsState.isInitialized) return false
      if (initialQuery.isError) return false
      return !initialQuery.isSuccess
    },
    get isLoadingMore() {
      return historyQuery.isFetchingNextPage
    },
    get hasMore() {
      return historyQuery.hasNextPage ?? true
    },
    get error() {
      return initialQuery.error ?? historyQuery.error ?? null
    },
    get isInitialized() {
      return initialQuery.isSuccess
    },
    /** Number of new posts waiting to be shown */
    get pendingCount() {
      return pendingCount()
    },

    loadMore: () => {
      if (!historyQuery.isFetchingNextPage && historyQuery.hasNextPage) {
        historyQuery.fetchNextPage()
      }
    },
    refresh: () => {
      initialQuery.refetch()
    },
    retry: () => {
      if (initialQuery.isError) {
        initialQuery.refetch()
      }
    },
    /** Reveal pending posts (when user clicks "N new posts" button) */
    showNewPosts: revealPendingPosts,
  }
}
