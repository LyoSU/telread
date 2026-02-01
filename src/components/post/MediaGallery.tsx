import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import { Portal } from 'solid-js/web'
import { Motion } from 'solid-motionone'
import { useMedia } from '@/lib/query'
import { Play, X, ChevronLeft, ChevronRight } from 'lucide-solid'
import type { MessageMedia } from '@/lib/telegram'

interface MediaItem {
  channelId: number
  messageId: number
  media: MessageMedia
}

interface MediaGalleryProps {
  items: MediaItem[]
  class?: string
}

/**
 * Media gallery for albums (grouped posts)
 * Threads-style horizontal scrolling row
 */
export function MediaGallery(props: MediaGalleryProps) {
  const [expandedIndex, setExpandedIndex] = createSignal<number | null>(null)

  return (
    <div class={`relative ${props.class ?? ''}`}>
      {/* Horizontal scrolling container - Threads style */}
      <div class="flex gap-1.5 overflow-x-auto scrollbar-hide px-4 -mx-4 snap-x snap-mandatory">
        <For each={props.items}>
          {(item, index) => (
            <GalleryItem
              item={item}
              onClick={() => setExpandedIndex(index())}
            />
          )}
        </For>
      </div>

      {/* Fullscreen modal - rendered in Portal to avoid event propagation issues */}
      <Show when={expandedIndex() !== null}>
        <Portal>
          <GalleryModal
            items={props.items}
            initialIndex={expandedIndex()!}
            onClose={() => setExpandedIndex(null)}
          />
        </Portal>
      </Show>
    </div>
  )
}

/**
 * Single item in the gallery - shows inline thumb, then full image
 */
function GalleryItem(props: {
  item: MediaItem
  onClick: () => void
}) {
  const [isVisible, setIsVisible] = createSignal(false)
  let observer: IntersectionObserver | undefined

  const isAnimation = () => props.item.media.type === 'animation'

  // Load full resolution (animations need full, others need large)
  const mediaQuery = useMedia(
    () => props.item.channelId,
    () => props.item.messageId,
    () => isAnimation() ? undefined : 'large',
    isVisible
  )

  const setupObserver = (el: HTMLDivElement) => {
    observer = new IntersectionObserver(
      (entries) => {
        // Check observer still exists (not cleaned up)
        if (entries[0]?.isIntersecting && observer) {
          observer.disconnect()
          observer = undefined
          setIsVisible(true)
        }
      },
      { rootMargin: '400px', threshold: 0 }
    )
    observer.observe(el)
  }

  onCleanup(() => {
    observer?.disconnect()
    observer = undefined
  })

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      props.onClick()
    }
  }

  const mediaType = () => 
    props.item.media.type === 'video' || props.item.media.type === 'animation' 
      ? 'video' 
      : 'image'

  // Calculate width based on aspect ratio for fixed height
  const aspectRatio = () => {
    const w = props.item.media.width
    const h = props.item.media.height
    if (w && h && h > 0) return w / h
    return 1 // Square fallback
  }

  return (
    <div
      ref={setupObserver}
      role="button"
      tabIndex={0}
      aria-label={`View ${mediaType()} in fullscreen`}
      class="relative h-[240px] flex-shrink-0 cursor-pointer overflow-hidden rounded-2xl snap-start focus:outline-none focus:ring-2 focus:ring-[var(--accent)] shadow-sm hover:shadow-md transition-shadow"
      style={{ width: `${240 * aspectRatio()}px`, 'min-width': '160px', 'max-width': '320px' }}
      onClick={(e) => {
        e.stopPropagation()
        props.onClick()
      }}
      onKeyDown={handleKeyDown}
    >
      {/* Full media (shows when loaded) */}
      <Show when={mediaQuery.data}>
        {(url) => (
          <Show
            when={isAnimation()}
            fallback={
              <img
                src={url()}
                alt={`Media ${mediaType()}`}
                class="w-full h-full object-cover hover:scale-[1.02] transition-transform duration-200"
                loading="lazy"
              />
            }
          >
            {/* GIF/Animation plays inline */}
            <video
              src={url()}
              class="w-full h-full object-cover"
              autoplay
              muted
              loop
              playsinline
            />
          </Show>
        )}
      </Show>
      {/* Inline thumbnail with blur (shows while full loads) */}
      <Show when={!mediaQuery.data}>
        <Show when={props.item.media.thumb} fallback={<div class="absolute inset-0 skeleton" />}>
          <img src={props.item.media.thumb} alt="" class="absolute inset-0 w-full h-full object-cover blur-sm scale-105" />
        </Show>
      </Show>

      {/* Video indicator - only for actual videos, not GIFs */}
      <Show when={props.item.media.type === 'video'}>
        <div class="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
          <div class="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
            <Play size={20} class="text-gray-900 ml-0.5" fill="currentColor" />
          </div>
        </div>
      </Show>
    </div>
  )
}

/**
 * Fullscreen gallery modal with navigation
 */
function GalleryModal(props: {
  items: MediaItem[]
  initialIndex: number
  onClose: () => void
}) {
  const [currentIndex, setCurrentIndex] = createSignal(props.initialIndex)

  const currentItem = () => props.items[currentIndex()]
  const canGoPrev = () => currentIndex() > 0
  const canGoNext = () => currentIndex() < props.items.length - 1

  const goToPrev = () => setCurrentIndex((i) => Math.max(0, i - 1))
  const goToNext = () => setCurrentIndex((i) => Math.min(props.items.length - 1, i + 1))

  // Track if closed by back button
  let closedByBackButton = false
  
  // Swipe handling
  let touchStartX = 0
  let touchStartY = 0
  let touchDeltaX = 0
  let touchDeltaY = 0
  const [swipeOffset, setSwipeOffset] = createSignal({ x: 0, y: 0 })
  const SWIPE_THRESHOLD = 50

  const handleTouchStart = (e: TouchEvent) => {
    touchStartX = e.touches[0].clientX
    touchStartY = e.touches[0].clientY
    touchDeltaX = 0
    touchDeltaY = 0
  }

  const handleTouchMove = (e: TouchEvent) => {
    touchDeltaX = e.touches[0].clientX - touchStartX
    touchDeltaY = e.touches[0].clientY - touchStartY
    
    // Only track vertical for dismiss, show visual feedback
    if (Math.abs(touchDeltaY) > Math.abs(touchDeltaX) && touchDeltaY > 0) {
      setSwipeOffset({ x: 0, y: touchDeltaY })
      e.preventDefault()
    }
  }

  const handleTouchEnd = () => {
    // Swipe down to close
    if (touchDeltaY > SWIPE_THRESHOLD * 2 && Math.abs(touchDeltaY) > Math.abs(touchDeltaX)) {
      closeModal()
      return
    }
    
    // Swipe left/right to navigate
    if (Math.abs(touchDeltaX) > SWIPE_THRESHOLD && Math.abs(touchDeltaX) > Math.abs(touchDeltaY)) {
      if (touchDeltaX > 0) {
        goToPrev()
      } else {
        goToNext()
      }
    }
    
    // Reset offset
    setSwipeOffset({ x: 0, y: 0 })
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeModal()
    }
    if (e.key === 'ArrowLeft') goToPrev()
    if (e.key === 'ArrowRight') goToNext()
  }

  const handlePopState = () => {
    closedByBackButton = true
    props.onClose()
  }

  const closeModal = () => {
    if (!closedByBackButton) {
      history.back()
    }
    props.onClose()
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    
    // Push fake history entry so back button closes modal
    history.pushState({ modal: 'gallery' }, '')
    window.addEventListener('popstate', handlePopState)
  })

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('popstate', handlePopState)
    document.body.style.overflow = ''
  })

  // Load full resolution for current item - query handles cleanup
  // Guard against empty items array
  const fullQuery = useMedia(
    () => currentItem()?.channelId ?? 0,
    () => currentItem()?.messageId ?? 0,
    () => undefined
  )

  return (
    <Motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      class="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center"
      onClick={closeModal}
    >
      {/* Close button */}
      <button
        type="button"
        aria-label="Close"
        class="absolute top-4 right-4 p-2 text-white/70 hover:text-white transition-colors z-10"
        onClick={closeModal}
      >
        <X size={32} />
      </button>

      {/* Counter */}
      <div class="absolute top-4 left-4 text-white/70 text-sm z-10">
        {currentIndex() + 1} / {props.items.length}
      </div>

      {/* Navigation buttons */}
      <Show when={canGoPrev()}>
        <button
          type="button"
          aria-label="Previous"
          class="absolute left-4 top-1/2 -translate-y-1/2 p-3 text-white/70 hover:text-white transition-colors z-10"
          onClick={(e) => { e.stopPropagation(); goToPrev() }}
        >
          <ChevronLeft size={32} />
        </button>
      </Show>

      <Show when={canGoNext()}>
        <button
          type="button"
          aria-label="Next"
          class="absolute right-4 top-1/2 -translate-y-1/2 p-3 text-white/70 hover:text-white transition-colors z-10"
          onClick={(e) => { e.stopPropagation(); goToNext() }}
        >
          <ChevronRight size={32} />
        </button>
      </Show>

      {/* Media content - with swipe gestures */}
      <div
        class="w-full h-full flex items-center justify-center p-4 transition-transform duration-150"
        style={{ transform: `translateY(${swipeOffset().y}px)`, opacity: 1 - swipeOffset().y / 300 }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <Show
          when={fullQuery.data}
          fallback={
            <div class="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full" />
          }
        >
          {(url) => (
            <Show
              when={currentItem().media.type === 'video' || currentItem().media.type === 'animation'}
              fallback={
                <img
                  src={url()}
                  alt=""
                  class="max-w-full max-h-full object-contain"
                />
              }
            >
              <video
                src={url()}
                class="max-w-full max-h-full"
                controls
                autoplay
                muted={currentItem().media.type === 'animation'}
                loop={currentItem().media.type === 'animation'}
              />
            </Show>
          )}
        </Show>
      </div>
    </Motion.div>
  )
}
