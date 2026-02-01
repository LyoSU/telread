import { For, Show, createSignal, createEffect, onCleanup, onMount } from 'solid-js'
import { Portal } from 'solid-js/web'
import { useMedia } from '@/lib/query'
import { createLightbox, type LightboxItem } from '@/components/ui'
import { Play, X } from 'lucide-solid'
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
 * Threads-style horizontal scrolling row + PhotoSwipe lightbox for images
 */
export function MediaGallery(props: MediaGalleryProps) {
  const [expandedIndex, setExpandedIndex] = createSignal<number | null>(null)
  const [videoModalUrl, setVideoModalUrl] = createSignal<string | null>(null)
  const [videoModalLoading, setVideoModalLoading] = createSignal(false)
  const lightbox = createLightbox()

  // Load full resolution URLs for all items when expanded
  const fullUrls = new Map<number, string>()
  
  // Create queries for all items - they load lazily
  const queries = () => props.items.map((item, index) => ({
    index,
    query: useMedia(
      () => item.channelId,
      () => item.messageId,
      () => undefined,
      () => expandedIndex() !== null
    )
  }))

  // Track loaded URLs and open appropriate viewer
  createEffect(() => {
    const idx = expandedIndex()
    if (idx === null) return

    // Collect all available URLs
    for (const { index, query } of queries()) {
      if (query.data) {
        fullUrls.set(index, query.data)
      }
    }

    const item = props.items[idx]
    const currentUrl = fullUrls.get(idx)
    const isVideo = item.media.type === 'video' || item.media.type === 'animation'

    if (currentUrl) {
      if (isVideo) {
        // Open video modal
        setVideoModalUrl(currentUrl)
        setVideoModalLoading(false)
      } else {
        // Open PhotoSwipe for images only
        openLightbox(idx)
      }
    } else if (isVideo) {
      setVideoModalLoading(true)
    }
  })

  const openLightbox = (startIndex: number) => {
    // Filter to only images for PhotoSwipe
    const imageItems: { originalIndex: number; item: LightboxItem }[] = []
    
    props.items.forEach((item, index) => {
      const isVideo = item.media.type === 'video' || item.media.type === 'animation'
      if (!isVideo) {
        const url = fullUrls.get(index)
        imageItems.push({
          originalIndex: index,
          item: {
            src: url || item.media.thumb || '',
            width: item.media.width || 1200,
            height: item.media.height || 800,
            thumb: item.media.thumb,
            type: 'image',
          }
        })
      }
    })

    if (imageItems.length === 0) return

    // Find the index within images array
    const imageIndex = imageItems.findIndex(i => i.originalIndex === startIndex)
    const pswpIndex = imageIndex >= 0 ? imageIndex : 0

    const pswp = lightbox.open(imageItems.map(i => i.item), pswpIndex)
    
    pswp?.on('close', () => {
      setExpandedIndex(null)
    })
  }

  const handleItemClick = (index: number) => {
    const item = props.items[index]
    const isVideo = item.media.type === 'video' || item.media.type === 'animation'
    
    setExpandedIndex(index)
    
    // If URL already loaded
    const url = fullUrls.get(index)
    if (url) {
      if (isVideo) {
        setVideoModalUrl(url)
      } else {
        openLightbox(index)
      }
    } else if (isVideo) {
      setVideoModalLoading(true)
    }
  }

  const closeVideoModal = () => {
    setVideoModalUrl(null)
    setVideoModalLoading(false)
    setExpandedIndex(null)
  }

  return (
    <div class={`relative ${props.class ?? ''}`}>
      {/* Horizontal scrolling container - Threads style */}
      <div class="flex gap-1.5 overflow-x-auto scrollbar-hide px-4 -mx-4 snap-x snap-mandatory">
        <For each={props.items}>
          {(item, index) => (
            <GalleryItem
              item={item}
              onClick={() => handleItemClick(index())}
            />
          )}
        </For>
      </div>

      {/* Video modal */}
      <Show when={videoModalUrl() || videoModalLoading()}>
        <Portal>
          <VideoModal
            url={videoModalUrl()}
            isLoading={videoModalLoading()}
            onClose={closeVideoModal}
          />
        </Portal>
      </Show>
    </div>
  )
}

/**
 * Simple video modal for gallery videos
 */
function VideoModal(props: {
  url: string | null
  isLoading: boolean
  onClose: () => void
}) {
  let closedByBack = false
  let touchStartY = 0
  const [offsetY, setOffsetY] = createSignal(0)

  const handleTouchStart = (e: TouchEvent) => {
    touchStartY = e.touches[0].clientY
  }

  const handleTouchMove = (e: TouchEvent) => {
    const deltaY = e.touches[0].clientY - touchStartY
    if (deltaY > 0) setOffsetY(deltaY)
  }

  const handleTouchEnd = () => {
    if (offsetY() > 100) {
      close()
    } else {
      setOffsetY(0)
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  const handlePopState = () => {
    closedByBack = true
    props.onClose()
  }

  const close = () => {
    if (!closedByBack) history.back()
    props.onClose()
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    history.pushState({ modal: 'video' }, '')
    window.addEventListener('popstate', handlePopState)
  })

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('popstate', handlePopState)
    document.body.style.overflow = ''
  })

  const opacity = () => Math.max(0, 1 - offsetY() / 300)

  return (
    <div
      class="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ 'background-color': `rgba(0, 0, 0, ${opacity()})` }}
      onClick={close}
    >
      <button
        type="button"
        aria-label="Close"
        class="absolute top-4 right-4 p-2 text-white/70 hover:text-white z-20 transition-colors"
        style={{ 'padding-top': 'env(safe-area-inset-top, 0)' }}
        onClick={close}
      >
        <X size={32} />
      </button>

      <div
        class="w-full h-full flex items-center justify-center p-4"
        style={{
          transform: `translateY(${offsetY()}px)`,
          transition: offsetY() === 0 ? 'transform 0.2s ease-out' : 'none',
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <Show
          when={props.url}
          fallback={
            <Show when={props.isLoading}>
              <div class="animate-spin w-10 h-10 border-2 border-white border-t-transparent rounded-full" />
            </Show>
          }
        >
          {(url) => (
            <video
              src={url()}
              class="max-w-full max-h-full"
              controls
              autoplay
              playsinline
            />
          )}
        </Show>
      </div>
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

  const mediaQuery = useMedia(
    () => props.item.channelId,
    () => props.item.messageId,
    () => isAnimation() ? undefined : 'large',
    isVisible
  )

  const setupObserver = (el: HTMLDivElement) => {
    observer = new IntersectionObserver(
      (entries) => {
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

  const aspectRatio = () => {
    const w = props.item.media.width
    const h = props.item.media.height
    if (w && h && h > 0) return w / h
    return 1
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
      
      <Show when={!mediaQuery.data}>
        <Show when={props.item.media.thumb} fallback={<div class="absolute inset-0 skeleton" />}>
          <img src={props.item.media.thumb} alt="" class="absolute inset-0 w-full h-full object-cover blur-sm scale-105" />
        </Show>
      </Show>

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
