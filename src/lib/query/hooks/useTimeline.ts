import { createQuery, createInfiniteQuery } from '@tanstack/solid-query'
import { createEffect, on, createMemo, onCleanup, untrack } from 'solid-js'
import {
  fetchMessages,
  fetchChannelsWithLastMessages,
  fetchArchivedChannelIds,
  onTimelineLoaded,
  sliceWithCompleteGroups,
  updateOpenChannels,
  closeAllChannels,
  preloadThumbnails,
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
  restoreArchivedIdsFromCache,
  folderStore,
  preferencesStore,
  startActivityTracking,
  setArchivedChannelIds,
  isChannelArchived,
  getArchivedChannelIds,
} from '@/lib/store'
import { getTime, groupPostsByMediaGroup, type TimelineItem } from '@/lib/utils'
import { queryKeys } from '../keys'
import { TIMING } from '@/config/constants'

/** Cooldown for archived IDs refresh (5 minutes) */
const ARCHIVED_REFRESH_COOLDOWN_MS = TIMING.QUERY_STALE_TIME
let lastArchivedRefreshTime = 0
let pendingRefreshPromise: Promise<void> | null = null

/**
 * Refresh archived channel IDs in background
 * Called on startup and when tab becomes visible
 * Has cooldown to prevent excessive API calls
 * Deduplicates concurrent calls to prevent race conditions
 */
function refreshArchivedIds(force = false): Promise<void> {
  // Return existing promise if refresh is already in progress
  if (pendingRefreshPromise) {
    return pendingRefreshPromise
  }

  const now = Date.now()

  // Skip if within cooldown (unless forced)
  if (!force && now - lastArchivedRefreshTime < ARCHIVED_REFRESH_COOLDOWN_MS) {
    if (import.meta.env.DEV) {
      const remaining = Math.round((ARCHIVED_REFRESH_COOLDOWN_MS - (now - lastArchivedRefreshTime)) / 1000)
      console.log(`[Timeline] Skipping archived refresh (cooldown: ${remaining}s remaining)`)
    }
    return Promise.resolve()
  }

  lastArchivedRefreshTime = now

  pendingRefreshPromise = fetchArchivedChannelIds()
    .then((archivedIds) => {
      // Always apply result — empty Set means user un-archived everything
      setArchivedChannelIds(archivedIds)
    })
    .catch((error: unknown) => {
      if (import.meta.env.DEV) {
        console.warn('[Timeline] Failed to fetch archived channel IDs:', error)
      }
      // Keep existing cached data on error
    })
    .finally(() => {
      pendingRefreshPromise = null
    })

  return pendingRefreshPromise
}

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
    staleTime: TIMING.QUERY_STALE_TIME,
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
 * Timeline data structure - channels and grouped posts
 * Note: channelMap is derived in useOptimizedTimeline via createMemo
 */
export interface TimelineData {
  channels: ChannelWithLastMessage[]
  /** Additional posts from media groups (albums) */
  groupedPosts: Message[]
}

/**
 * Fetch initial timeline data - channels with their last messages
 * 
 * IMPORTANT: Always fetches ALL channels (including archived) with isArchived flag.
 * Filtering is done at display level based on user preferences.
 */
async function fetchInitialTimeline(): Promise<TimelineData> {
  const startTime = performance.now()
  if (import.meta.env.DEV) {
    console.log('[Timeline] fetchInitialTimeline starting...')
  }

  const { channels, groupedPosts } = await fetchChannelsWithLastMessages()

  if (import.meta.env.DEV) {
    const postCount = channels.filter((c) => c.lastMessage).length
    const archivedCount = channels.filter((c) => c.isArchived).length
    console.log(`[Timeline] fetchInitialTimeline done: ${channels.length} channels (${archivedCount} archived), ${postCount} posts, ${groupedPosts.length} grouped posts in ${Math.round(performance.now() - startTime)}ms`)
  }

  return { channels, groupedPosts }
}

/**
 * Fetch more history for lazy loading
 */
async function fetchTimelineHistory(
  channelIds: number[],
  channelOffsets: Map<number, number>,
  limit: number = 20
): Promise<Message[]> {
  // Limit parallel requests to avoid FLOOD_WAIT
  const channelsToFetch = channelIds.slice(0, 2)
  const messagesPerChannel = Math.ceil(limit / channelsToFetch.length)

  const allMessages: Message[] = []

  // Fetch sequentially with small delay to be safe
  for (const channelId of channelsToFetch) {
    try {
      // Use per-channel offset — message IDs are per-channel, not global
      const offsetId = channelOffsets.get(channelId) ?? 0
      const messages = await fetchMessages(channelId, { limit: messagesPerChannel, maxId: offsetId })
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

/** Shared filtering logic for timeline and pending count memos */
function filterPostsByContext(
  keys: string[],
  byId: Record<string, Message>,
  archivedIds: Set<number> | null,
  folderChannelIds: number[] | null,
): Message[] {
  let posts = keys.map((key) => byId[key]).filter(Boolean) as Message[]

  if (archivedIds) {
    posts = posts.filter(post => !archivedIds.has(post.channelId))
  }

  if (folderChannelIds && folderChannelIds.length > 0) {
    const allowedChannelIds = new Set(folderChannelIds)
    posts = posts.filter(post => allowedChannelIds.has(post.channelId))
  }

  return posts
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

  // Initial data query - fetches ALL channels (including archived) with isArchived flag
  // Filtering is done at display level based on hideArchived preference
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
      // Build per-channel offsets from the pageParam map
      return fetchTimelineHistory(ids, pageParam, 20)
    },
    initialPageParam: new Map<number, number>(),
    getNextPageParam: (lastPage) => {
      if (lastPage.length === 0) return undefined
      // Build per-channel offset map: each channel's oldest message ID
      const offsets = new Map<number, number>()
      for (const msg of lastPage) {
        const existing = offsets.get(msg.channelId)
        if (!existing || msg.id < existing) {
          offsets.set(msg.channelId, msg.id)
        }
      }
      return offsets
    },
    // Enable if we have channels to fetch from
    enabled: !!initialQuery.data?.channels || (folderStore.selectedFolderId !== null && folderStore.channelIdsInFolder.length > 0),
    staleTime: TIMING.QUERY_STALE_TIME,
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
        
        // Restore archived IDs from cache for instant filtering
        restoreArchivedIdsFromCache()

        // Extract posts from channels and grouped albums
        // upsertPosts handles duplicates (only updates if newer)
        const lastMessages = data.channels
          .filter((c) => c.lastMessage)
          .map((c) => c.lastMessage!)

        // Include grouped posts (complete albums) from initial fetch
        const groupedPosts = data.groupedPosts ?? []
        const allPosts = [...lastMessages, ...groupedPosts]

        if (import.meta.env.DEV) {
          console.log(`[Timeline] Restoring: ${lastMessages.length} from lastMessage, ${groupedPosts.length} from groups`)
        }

        if (allPosts.length > 0) {
          upsertPosts(allPosts)
          
          // Prefetch thumbnails for posts with media (low priority, background)
          const postsWithMedia = allPosts
            .filter(p => p.media && ['photo', 'video', 'animation', 'document'].includes(p.media.type))
            .slice(0, 20) // Limit prefetch to first 20 posts
            .map(p => ({ channelId: p.channelId, messageId: p.id }))
          
          if (postsWithMedia.length > 0) {
            // Delay prefetch to not compete with visible media
            setTimeout(() => {
              void preloadThumbnails(postsWithMedia, 'low')
            }, 1000)
          }
        }

        // Only run initialization once
        if (!hasInitialized) {
          hasInitialized = true
          markStoreInitialized()
          // Process messages that arrived before timeline was ready
          onTimelineLoaded()

          // Fetch fresh archived channel IDs in background (uses raw API due to mtcute bug)
          // Cache was already restored above for instant filtering
          // Force=true on startup to ensure fresh data
          void refreshArchivedIds(true)

          // Open top channels for real-time updates (MTProto requirement)
          // This is critical for receiving consistent updates
          void updateOpenChannels(data.channels).catch((error) => {
            console.error('[Timeline] Failed to open channels:', error)
          })
        }
      }
    )
  )

  // Cleanup: close all open channels when component unmounts
  onCleanup(() => {
    void closeAllChannels().catch((error) => {
      console.error('[Timeline] Failed to close channels during cleanup:', error)
    })
  })
  
  // Start activity tracking (updates lastActive timestamp periodically)
  // This is used to determine sync strategy on next app start
  const stopActivityTracking = startActivityTracking()
  onCleanup(stopActivityTracking)
  
  // Refresh archived IDs when tab becomes visible (catches changes from other devices)
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      refreshArchivedIds()
    }
  }
  document.addEventListener('visibilitychange', handleVisibility)
  onCleanup(() => document.removeEventListener('visibilitychange', handleVisibility))

  // Populate posts from history pages (from cache or after scroll fetch)
  // Track processed page count to avoid re-processing — reset on folder switch
  let lastProcessedPageCount = 0
  let lastProcessedFolderId: number | null = null
  createEffect(
    on(
      () => historyQuery.data?.pages,
      (pages) => {
        if (!pages || pages.length === 0) return
        // Reset counter when folder changes (query key changed, pages reset)
        const currentFolderId = folderStore.selectedFolderId
        if (currentFolderId !== lastProcessedFolderId) {
          lastProcessedFolderId = currentFolderId
          lastProcessedPageCount = 0
        }
        // Only process new pages
        if (pages.length <= lastProcessedPageCount) return

        if (import.meta.env.DEV) {
          console.log(`[Timeline] History pages: ${lastProcessedPageCount} -> ${pages.length}, total posts: ${pages.flat().length}`)
        }
        lastProcessedPageCount = pages.length

        const posts = pages.flat()
        if (posts.length > 0) {
          upsertPosts(posts)
          
          // Prefetch thumbnails for new history posts
          const postsWithMedia = posts
            .filter(p => p.media && ['photo', 'video', 'animation', 'document'].includes(p.media.type))
            .slice(0, 10)
            .map(p => ({ channelId: p.channelId, messageId: p.id }))
          
          if (postsWithMedia.length > 0) {
            void preloadThumbnails(postsWithMedia, 'low')
          }
        }
      }
    )
  )

  // Cache for stable item references — prevents <For> from remounting components
  // when the timeline memo recomputes but individual items haven't changed.
  // SolidJS <For> uses reference identity; new wrapper objects → full remount → media flicker.
  let itemCache = new Map<string, TimelineItem>()

  // Reactive timeline from centralized store
  // Only re-runs when sortedKeys order changes (post add/remove) or filter settings change
  // byId content changes (views, reactions) are untracked — they don't affect grouping/filtering
  // FILTERING: Only show posts from channels in our store + folder filter
  const timeline = createMemo(() => {
    const keys = postsState.sortedKeys // TRACKED - triggers on order change
    const hideArchived = preferencesStore.preferences.hideArchived
    const folderId = folderStore.selectedFolderId
    const folderChannelIds = folderStore.channelIdsInFolder
    // TRACKED — reading the Set reference ensures memo re-runs when archived IDs change
    const archivedIds = hideArchived ? getArchivedChannelIds() : null

    return untrack(() => { // UNTRACKED - byId content changes won't trigger recomputation
      const posts = filterPostsByContext(
        keys, postsState.byId,
        archivedIds,
        folderId !== null ? folderChannelIds : null
      )

      // Group posts by groupedId for albums
      const items = groupPostsByMediaGroup(posts)

      // Stabilize references: reuse cached objects when underlying data is identical.
      // This prevents <For> from treating unchanged items as new (causing media remount/flicker).
      const nextCache = new Map<string, TimelineItem>()
      const stable: TimelineItem[] = new Array(items.length)

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const key = item.type === 'single'
          ? `${item.post.channelId}:${item.post.id}`
          : `g:${item.groupedId}`

        const cached = itemCache.get(key)
        if (cached && cached.type === item.type) {
          // Compare store proxy references — stable unless the post was reassigned
          if (item.type === 'single' && cached.type === 'single' && cached.post === item.post) {
            stable[i] = cached
            nextCache.set(key, cached)
            continue
          }
          if (item.type === 'group' && cached.type === 'group' &&
              cached.posts.length === item.posts.length &&
              cached.posts.every((p, j) => p === item.posts[j])) {
            stable[i] = cached
            nextCache.set(key, cached)
            continue
          }
        }

        stable[i] = item
        nextCache.set(key, item)
      }

      itemCache = nextCache
      return stable
    })
  })

  // Pending count - grouped by media group for accurate count
  // FILTERING: Only count posts from channels in our store + folder filter
  const pendingCount = createMemo(() => {
    const keys = postsState.pendingKeys // TRACKED
    if (keys.length === 0) return 0

    const hideArchived = preferencesStore.preferences.hideArchived
    const folderId = folderStore.selectedFolderId
    const folderChannelIds = folderStore.channelIdsInFolder
    const archivedIds = hideArchived ? getArchivedChannelIds() : null

    return untrack(() => {
      const posts = filterPostsByContext(
        keys, postsState.byId,
        archivedIds,
        folderId !== null ? folderChannelIds : null
      )
      return groupPostsByMediaGroup(posts).length
    })
  })

  // Filtered channels based on selected folder and hideArchived preference
  const filteredChannels = createMemo(() => {
    let channels = getChannels()

    // Filter out archived channels when hideArchived=true
    if (preferencesStore.preferences.hideArchived) {
      channels = channels.filter(channel => !isChannelArchived(channel.id))
    }

    // If no folder selected, return all (non-archived) channels
    if (folderStore.selectedFolderId === null) {
      return channels
    }

    // Filter channels by folder
    if (folderStore.channelIdsInFolder.length === 0) {
      return []
    }

    const allowedChannelIds = new Set(folderStore.channelIdsInFolder)
    return channels.filter(channel => allowedChannelIds.has(channel.id))
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
    refresh: () => initialQuery.refetch(),
    retry: () => {
      if (initialQuery.isError) {
        initialQuery.refetch()
      }
    },
    /** Reveal pending posts (when user clicks "N new posts" button) */
    showNewPosts: revealPendingPosts,
  }
}
