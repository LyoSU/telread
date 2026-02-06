import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { Portal } from 'solid-js/web'
import { TimelinePost } from './TimelinePost'
import { TimelineGroup } from './TimelineGroup'
import { PostSkeleton } from '@/components/ui'
import { INFINITE_SCROLL_THRESHOLD, TIMING, isMobile } from '@/config/constants'
import { haptic } from '@/lib/utils'
import { Newspaper, ChevronUp } from 'lucide-solid'
import type { Channel } from '@/lib/telegram'
import type { Message } from '@/lib/telegram'
import type { TimelineItem } from '@/lib/utils'

const EMPTY_ITEMS: TimelineItem[] = []

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
  /** Pre-computed channel map — avoids recreating from channels array */
  channelMap?: Map<number, Channel>
  /** Pull-to-refresh callback — return promise to keep spinner until complete */
  onRefresh?: () => Promise<unknown> | void
}

/**
 * Timeline item wrapper with content-visibility optimization
 * Browser skips rendering of off-screen items automatically
 */
function TimelineItemWrapper(props: {
  item: TimelineItem
  getChannel: (id: number) => Channel | undefined
}) {
  return (
    <article
      class="timeline-item"
      style={{
        'content-visibility': 'auto',
        'contain-intrinsic-size': 'auto 300px',
        contain: 'layout style paint',
      }}
    >
      <Show
        when={props.item.type === 'single'}
        fallback={
          <GroupPostItem
            item={props.item as { type: 'group'; posts: Message[]; groupedId: bigint }}
            getChannel={props.getChannel}
          />
        }
      >
        <SinglePostItem
          item={props.item as { type: 'single'; post: Message }}
          getChannel={props.getChannel}
        />
      </Show>
    </article>
  )
}

/**
 * Helper component for single posts
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
 * Timeline feed component with CSS content-visibility optimization
 *
 * Uses native browser optimization via content-visibility: auto
 * Combined with existing IntersectionObserver-based lazy loading for media
 */
export function Timeline(props: TimelineProps) {
  let containerRef: HTMLDivElement | undefined
  let scrollParent: HTMLElement | null = null
  let loadMoreRef: HTMLDivElement | undefined
  let topSentinelRef: HTMLDivElement | undefined
  let loadMoreObserver: IntersectionObserver | null = null
  let topObserver: IntersectionObserver | null = null
  let restoreTimer: ReturnType<typeof setTimeout> | null = null
  let rafId: number | null = null

  // Flag to prevent scroll restoration after user has scrolled
  let hasUserScrolled = false
  let scrollRestored = false

  // Scroll-to-top button (uses IntersectionObserver — no scroll event overhead)
  const [showScrollTop, setShowScrollTop] = createSignal(false)

  // Pull-to-refresh state (mobile only)
  const [pullDistance, setPullDistance] = createSignal(0)
  const [isRefreshing, setIsRefreshing] = createSignal(false)
  let pullStartY = 0
  let pullActive = false
  let pullStarted = false
  const PULL_THRESHOLD = 64
  const MAX_PULL = 128
  const PULL_RESISTANCE = 0.4

  // Channel lookup — use pre-computed map if provided, otherwise build from array
  const channelMap = props.channelMap
    ? () => props.channelMap!
    : createMemo(() => {
        const map = new Map<number, Channel>()
        for (const c of props.channels) {
          map.set(c.id, c)
        }
        return map
      })

  // Get channel by ID
  const getChannel = (channelId: number) => channelMap().get(channelId)

  // All items to render
  const allItems = createMemo(() => props.items ?? EMPTY_ITEMS)

  // Scroll position storage keys
  const getScrollKey = () => (props.scrollKey ? `timeline-scroll:${props.scrollKey}` : null)

  // Save scroll position to sessionStorage
  const saveScrollPosition = () => {
    const scrollKey = getScrollKey()
    if (scrollKey && scrollParent) {
      sessionStorage.setItem(scrollKey, String(scrollParent.scrollTop))
    }
  }

  // Restore scroll position - only once on mount, before user scrolls
  const restoreScrollPosition = () => {
    if (scrollRestored || hasUserScrolled) return
    scrollRestored = true

    const scrollKey = getScrollKey()
    if (scrollKey && scrollParent) {
      const saved = sessionStorage.getItem(scrollKey)
      if (saved) {
        const scrollTop = parseInt(saved, 10)
        if (!isNaN(scrollTop) && scrollTop > 0) {
          rafId = requestAnimationFrame(() => {
            rafId = null
            if (scrollParent && !hasUserScrolled) {
              scrollParent.scrollTo({ top: scrollTop })
            }
          })
        }
      }
    }
  }

  // Handle scroll events
  const handleScroll = () => {
    if (!scrollParent) return
    // Mark that user has scrolled - prevents unwanted scroll restoration
    hasUserScrolled = true
  }

  // Setup IntersectionObserver for scroll-to-top button
  const setupScrollTopObserver = () => {
    if (!topSentinelRef || !scrollParent) return
    topObserver = new IntersectionObserver(
      ([entry]) => setShowScrollTop(!entry.isIntersecting),
      { root: scrollParent, rootMargin: '200px', threshold: 0 }
    )
    topObserver.observe(topSentinelRef)
  }

  // Setup pull-to-refresh (touch devices only)
  const setupPullToRefresh = () => {
    if (!isMobile || !scrollParent || !props.onRefresh) return

    const onTouchStart = (e: TouchEvent) => {
      if (scrollParent!.scrollTop > 0 || isRefreshing()) return
      pullStartY = e.touches[0].clientY
      pullStarted = true
      pullActive = false
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!pullStarted || isRefreshing() || !scrollParent) return
      const delta = e.touches[0].clientY - pullStartY
      if (delta <= 0 || scrollParent.scrollTop > 0) {
        pullActive = false
        if (pullDistance() > 0) setPullDistance(0)
        return
      }
      pullActive = true
      const dist = Math.min(delta * PULL_RESISTANCE, MAX_PULL)
      // Haptic at threshold crossing
      if (dist >= PULL_THRESHOLD && pullDistance() < PULL_THRESHOLD) {
        haptic('light')
      }
      setPullDistance(dist)
    }

    const onTouchEnd = () => {
      if (!pullActive) { pullStarted = false; return }
      pullStarted = false
      pullActive = false
      if (pullDistance() >= PULL_THRESHOLD && props.onRefresh) {
        setIsRefreshing(true)
        haptic('medium')
        Promise.resolve(props.onRefresh())
          .catch(() => {})
          .finally(() => {
            setIsRefreshing(false)
            setPullDistance(0)
          })
      } else {
        setPullDistance(0)
      }
    }

    scrollParent.addEventListener('touchstart', onTouchStart, { passive: true })
    scrollParent.addEventListener('touchmove', onTouchMove, { passive: true })
    scrollParent.addEventListener('touchend', onTouchEnd, { passive: true })

    onCleanup(() => {
      scrollParent?.removeEventListener('touchstart', onTouchStart)
      scrollParent?.removeEventListener('touchmove', onTouchMove)
      scrollParent?.removeEventListener('touchend', onTouchEnd)
    })
  }

  // Setup IntersectionObserver for infinite scroll
  const setupLoadMoreObserver = () => {
    if (!loadMoreRef) return

    loadMoreObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting && !props.isLoadingMore && props.hasMore) {
          props.onLoadMore()
        }
      },
      {
        root: scrollParent,
        rootMargin: `${INFINITE_SCROLL_THRESHOLD}px`,
        threshold: 0,
      }
    )

    loadMoreObserver.observe(loadMoreRef)
  }

  // Setup scroll listener on mount
  onMount(() => {
    scrollParent = getScrollParent(containerRef ?? null)

    if (scrollParent) {
      scrollParent.addEventListener('scroll', handleScroll, { passive: true })
      restoreTimer = setTimeout(restoreScrollPosition, TIMING.SCROLL_RESTORE_DELAY)
    }

    queueMicrotask(() => {
      setupLoadMoreObserver()
      setupScrollTopObserver()
      setupPullToRefresh()
    })
  })

  // Cleanup on unmount
  onCleanup(() => {
    // Only save scroll position if user actually scrolled
    if (hasUserScrolled) {
      saveScrollPosition()
    }

    if (scrollParent) {
      scrollParent.removeEventListener('scroll', handleScroll)
      scrollParent = null
    }

    if (loadMoreObserver) {
      loadMoreObserver.disconnect()
      loadMoreObserver = null
    }

    if (topObserver) {
      topObserver.disconnect()
      topObserver = null
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

  const isEmpty = () => !props.isLoading && allItems().length === 0
  const showSkeleton = () => props.isLoading && allItems().length === 0

  return (
    <div ref={containerRef} class="min-h-full pb-24">
      {/* Pull-to-refresh indicator */}
      <Show when={pullDistance() > 0 || isRefreshing()}>
        <div
          class="flex justify-center items-center overflow-hidden"
          style={{ height: `${isRefreshing() ? PULL_THRESHOLD : pullDistance()}px` }}
        >
          <div
            class={`w-5 h-5 rounded-full border-2 border-[var(--accent)] ${isRefreshing() ? 'animate-spin border-t-transparent' : ''}`}
            style={{
              opacity: Math.min(pullDistance() / PULL_THRESHOLD, 1),
              transform: isRefreshing() ? '' : `rotate(${pullDistance() * 4}deg)`,
            }}
          />
        </div>
      </Show>

      {/* Scroll-to-top sentinel */}
      <div ref={topSentinelRef} class="h-px" aria-hidden="true" />

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

      {/* Loading skeleton */}
      <Show when={showSkeleton()}>
        <For each={[1, 2, 3]}>{() => <PostSkeleton />}</For>
      </Show>

      {/* New posts button */}
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

      {/* Timeline items with content-visibility optimization */}
      <For each={allItems()}>
        {(item) => <TimelineItemWrapper item={item} getChannel={getChannel} />}
      </For>

      {/* Load more trigger */}
      <div ref={loadMoreRef} class="h-1" aria-hidden="true" />

      {/* Load more indicator */}
      <Show when={props.isLoadingMore}>
        <div class="flex justify-center py-4">
          <div class="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
        </div>
      </Show>

      {/* End of list */}
      <Show when={!props.hasMore && !props.isLoadingMore && (props.items ?? []).length > 0}>
        <div class="text-center py-8 text-sm text-tertiary">You've reached the end</div>
      </Show>

      {/* Scroll to top — Portal escapes PageTransition's containing block */}
      <Portal>
        <button
          type="button"
          class="fixed z-40 w-10 h-10 rounded-full flex items-center justify-center bg-[var(--color-bg)] border border-[var(--nav-border)] text-[var(--color-text-secondary)] active:scale-95 bottom-24 right-4 lg:bottom-6 lg:right-6 transition-opacity duration-200"
          classList={{
            'opacity-100 pointer-events-auto shadow-md': showScrollTop(),
            'opacity-0 pointer-events-none': !showScrollTop(),
          }}
          onClick={() => {
            haptic('light')
            scrollParent?.scrollTo({ top: 0, behavior: 'smooth' })
          }}
          aria-label="Scroll to top"
        >
          <ChevronUp size={20} />
        </button>
      </Portal>
    </div>
  )
}
