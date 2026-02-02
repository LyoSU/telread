import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { TimelinePost } from './TimelinePost'
import { TimelineGroup } from './TimelineGroup'
import { PostSkeleton } from '@/components/ui'
import { INFINITE_SCROLL_THRESHOLD, SCROLL_THROTTLE_MS, UI, TIMING } from '@/config/constants'
import { Newspaper } from 'lucide-solid'
// Visibility-based openChat removed - simple updateOpenChannels on load is sufficient
import type { Channel } from '@/lib/telegram'
import type { Message } from '@/lib/telegram'
import type { TimelineItem } from '@/lib/utils'

interface TimelineProps {
  items: TimelineItem[]
  channels: Channel[]
  isLoading: boolean
  isLoadingMore: boolean
  hasMore: boolean
  onLoadMore: () => void
  /** Number of new posts waiting to be shown */
  pendingCount?: number
  /** Called when user clicks "show new posts" button */
  onShowNewPosts?: () => void
  /** Key for scroll position restoration (e.g., 'home', 'channel-123') */
  scrollKey?: string
}

/**
 * Helper component for single posts
 * Always renders - uses fallback title if channel unknown
 */
function SinglePostItem(props: {
  item: { type: 'single'; post: Message }
  getChannel: (id: number) => Channel | undefined
}) {
  const channel = () => props.getChannel(props.item.post.channelId)

  return (
    <TimelinePost
      post={props.item.post}
      channelId={props.item.post.channelId}
      channelTitle={channel()?.title ?? 'Channel'}
      channelUsername={channel()?.username}
    />
  )
}

/**
 * Helper component for grouped posts
 * Always renders - uses fallback title if channel unknown
 */
function GroupPostItem(props: {
  item: { type: 'group'; posts: Message[]; groupedId: bigint }
  getChannel: (id: number) => Channel | undefined
}) {
  const primaryPost = () => props.item.posts.find((p) => p.text) || props.item.posts[0]
  const channel = () => props.getChannel(primaryPost().channelId)

  return (
    <TimelineGroup
      posts={props.item.posts}
      channelId={primaryPost().channelId}
      channelTitle={channel()?.title ?? 'Channel'}
      channelUsername={channel()?.username}
    />
  )
}

/**
 * Find the nearest scrollable parent element
 */
function getScrollParent(element: HTMLElement | null): HTMLElement | null {
  if (!element) return null

  let parent = element.parentElement
  while (parent) {
    const { overflow, overflowY } = getComputedStyle(parent)
    if (overflow === 'auto' || overflow === 'scroll' || overflowY === 'auto' || overflowY === 'scroll') {
      return parent
    }
    parent = parent.parentElement
  }
  return null
}

/**
 * Timeline feed component with infinite scroll
 *
 * Uses For with keyed items for efficient updates.
 * Scroll events are handled on the nearest scrollable parent.
 */
export function Timeline(props: TimelineProps) {
  let containerRef: HTMLDivElement | undefined
  let scrollParent: HTMLElement | null = null
  let throttleTimer: ReturnType<typeof setTimeout> | null = null
  let restoreTimer: ReturnType<typeof setTimeout> | null = null
  let rafId: number | null = null
  let ticking = false


  // Incremental rendering - start with few items, render more on scroll
  const [renderCount, setRenderCount] = createSignal(UI.INITIAL_RENDER_COUNT)
  
  // Items to actually render (limited for performance)
  const visibleItems = createMemo(() => {
    const items = props.items ?? []
    const count = renderCount()
    return items.slice(0, count)
  })
  
  // Check if we need to render more items
  const hasMoreToRender = createMemo(() => {
    const items = props.items ?? []
    return renderCount() < items.length
  })

  // Channel lookup map
  const channelMap = createMemo(() => {
    const map = new Map<number, Channel>()
    for (const c of props.channels) {
      map.set(c.id, c)
    }
    return map
  })

  // Scroll position storage keys
  const getScrollKey = () => props.scrollKey ? `timeline-scroll:${props.scrollKey}` : null
  const getRenderCountKey = () => props.scrollKey ? `timeline-render:${props.scrollKey}` : null

  // Save scroll position and render count to sessionStorage
  const saveScrollPosition = () => {
    const scrollKey = getScrollKey()
    const renderKey = getRenderCountKey()
    if (scrollKey && scrollParent) {
      sessionStorage.setItem(scrollKey, String(scrollParent.scrollTop))
    }
    if (renderKey) {
      sessionStorage.setItem(renderKey, String(renderCount()))
    }
  }

  // Restore render count first (sync), then scroll position (async)
  const restoreState = () => {
    const renderKey = getRenderCountKey()
    const scrollKey = getScrollKey()
    
    // Restore render count first so content is available
    if (renderKey) {
      const savedRenderCount = sessionStorage.getItem(renderKey)
      if (savedRenderCount) {
        const count = parseInt(savedRenderCount, 10)
        if (!isNaN(count) && count > UI.INITIAL_RENDER_COUNT) {
          setRenderCount(count)
        }
      }
    }
    
    // Then restore scroll position after content renders
    if (scrollKey && scrollParent) {
      const saved = sessionStorage.getItem(scrollKey)
      if (saved) {
        const scrollTop = parseInt(saved, 10)
        if (!isNaN(scrollTop)) {
          // Use requestAnimationFrame to ensure content is rendered
          rafId = requestAnimationFrame(() => {
            rafId = null
            scrollParent?.scrollTo({ top: scrollTop })
          })
        }
      }
    }
  }

  const handleScroll = () => {
    // Guard: if scrollParent is null, we've been cleaned up
    if (!scrollParent) return

    const scrollTop = scrollParent.scrollTop
    const scrollHeight = scrollParent.scrollHeight
    const clientHeight = scrollParent.clientHeight
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight

    // Save scroll position periodically
    if (props.scrollKey) {
      saveScrollPosition()
    }

    // Incremental rendering - NOT throttled (fast, no API call)
    if (distanceFromBottom < INFINITE_SCROLL_THRESHOLD && hasMoreToRender()) {
      setRenderCount(prev => Math.min(prev + UI.RENDER_BATCH_SIZE, (props.items?.length ?? 0)))
    }
    
    // API calls - throttled to prevent spam
    if (ticking) return
    if (distanceFromBottom < INFINITE_SCROLL_THRESHOLD && !props.isLoadingMore && props.hasMore && !hasMoreToRender()) {
      ticking = true
      props.onLoadMore()
      // Reset throttle after a delay
      throttleTimer = setTimeout(() => {
        ticking = false
        throttleTimer = null
      }, SCROLL_THROTTLE_MS)
    }
  }

  // Setup scroll listener on mount
  onMount(() => {
    scrollParent = getScrollParent(containerRef ?? null)
    if (scrollParent) {
      scrollParent.addEventListener('scroll', handleScroll, { passive: true })
      // Wait for content to be ready then restore state
      restoreTimer = setTimeout(restoreState, TIMING.SCROLL_RESTORE_DELAY)
    }
  })

  // Cleanup on unmount
  onCleanup(() => {
    saveScrollPosition()
    
    if (scrollParent) {
      scrollParent.removeEventListener('scroll', handleScroll)
      scrollParent = null // Clear reference to guard handleScroll
    }
    
    if (throttleTimer) {
      clearTimeout(throttleTimer)
      throttleTimer = null
    }
    
    if (restoreTimer) {
      clearTimeout(restoreTimer)
      restoreTimer = null
    }
    
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  })

  // Get channel by ID
  const getChannel = (channelId: number) => channelMap().get(channelId)

  const isEmpty = () => !props.isLoading && (props.items?.length ?? 0) === 0
  const showSkeleton = () => props.isLoading && (props.items?.length ?? 0) === 0

  return (
    <div ref={containerRef} class="min-h-full pb-24">
      {/* Empty state */}
      <Show when={isEmpty()}>
        <div class="flex flex-col items-center justify-center h-64 text-center px-4">
          <div class="w-16 h-16 rounded-2xl bg-[var(--accent)]/15 flex items-center justify-center mb-4">
            <Newspaper size={32} class="text-accent" />
          </div>
          <h3 class="text-lg font-semibold text-primary mb-1">No posts yet</h3>
          <p class="text-secondary text-sm mb-4">Subscribe to channels to see posts here</p>
          <a 
            href="/channels" 
            class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Add channels
          </a>
        </div>
      </Show>

      {/* Loading skeleton - minimal for faster render */}
      <Show when={showSkeleton()}>
        <For each={[1, 2, 3]}>{() => <PostSkeleton />}</For>
      </Show>

      {/* New posts button - Twitter style, positioned below sticky header */}
      <Show when={props.pendingCount && props.pendingCount > 0}>
        <div class="sticky top-14 z-10 flex justify-center py-3 pointer-events-none">
          <button
            type="button"
            onClick={() => {
              props.onShowNewPosts?.()
              scrollParent?.scrollTo({ top: 0, behavior: 'smooth' })
            }}
            class="new-posts-btn pointer-events-auto"
          >
            {props.pendingCount === 1 ? '1 new post' : `${props.pendingCount} new posts`}
          </button>
        </div>
      </Show>

      {/* Items list - handles both single posts and groups */}
      {/* Incremental rendering - only render visible items for performance */}
      <For each={visibleItems()}>
        {(item) => (
          <Show
            when={item.type === 'single'}
            fallback={
              <GroupPostItem
                item={item as { type: 'group'; posts: Message[]; groupedId: bigint }}
                getChannel={getChannel}
              />
            }
          >
            <SinglePostItem
              item={item as { type: 'single'; post: Message }}
              getChannel={getChannel}
            />
          </Show>
        )}
      </For>

      {/* Load more indicator */}
      <Show when={props.isLoadingMore}>
        <div class="flex justify-center py-4">
          <div class="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
        </div>
      </Show>

      {/* End of list */}
      <Show when={!props.hasMore && !props.isLoadingMore && (props.items?.length ?? 0) > 0}>
        <div class="text-center py-8 text-sm text-tertiary">You've reached the end</div>
      </Show>
    </div>
  )
}
