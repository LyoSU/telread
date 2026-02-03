import { For, Show, createSignal, createMemo, onCleanup } from 'solid-js'
import { Portal } from 'solid-js/web'
import { useMedia } from '@/lib/query'
import { VideoModal, Lightbox, type LightboxItem } from '@/components/ui'
import { Play } from 'lucide-solid'
import type { MessageMedia } from '@/lib/telegram'
import { MEDIA } from '@/config/constants'

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
 * Uses PhotoSwipe for photo viewing, VideoModal for videos
 */
export function MediaGallery(props: MediaGalleryProps) {
  const [expandedIndex, setExpandedIndex] = createSignal<number | null>(null)
  const [lightboxOpen, setLightboxOpen] = createSignal(false)
  const [lightboxIndex, setLightboxIndex] = createSignal(0)

  // Separate photo items for Lightbox navigation
  const photoItems = createMemo(() => 
    props.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.media.type === 'photo')
  )

  // Map gallery index to lightbox index
  const galleryToLightboxIndex = createMemo(() => {
    const map = new Map<number, number>()
    photoItems().forEach(({ index }, lightboxIdx) => {
      map.set(index, lightboxIdx)
    })
    return map
  })

  // Derived: expanded item data (for videos only now)
  const expandedItem = createMemo(() => {
    const idx = expandedIndex()
    return idx !== null ? props.items[idx] : null
  })
  
  const isExpandedVideo = createMemo(() => {
    const item = expandedItem()
    if (!item) return false
    return item.media.type === 'video' || item.media.type === 'animation'
  })

  // Load full resolution for expanded video
  const expandedMediaQuery = useMedia(
    () => expandedItem()?.channelId ?? 0,
    () => expandedItem()?.messageId ?? 0,
    () => undefined,
    () => expandedIndex() !== null && isExpandedVideo()
  )

  // Load full resolution for all photos in lightbox
  const photoMediaQueries = photoItems().map(({ item }) => 
    useMedia(
      () => item.channelId,
      () => item.messageId,
      () => undefined,
      lightboxOpen
    )
  )

  // Build lightbox items from loaded photos
  const lightboxItems = createMemo((): LightboxItem[] => {
    return photoItems().map(({ item }, idx) => {
      const query = photoMediaQueries[idx]
      return {
        src: query?.data || item.media.thumb || '',
        width: item.media.width || 1200,
        height: item.media.height || 800,
        thumb: item.media.thumb,
      }
    })
  })

  const handleItemClick = (index: number) => {
    const item = props.items[index]
    
    if (item.media.type === 'photo') {
      // Open PhotoSwipe for photos
      const lbIndex = galleryToLightboxIndex().get(index)
      if (lbIndex !== undefined) {
        setLightboxIndex(lbIndex)
        setLightboxOpen(true)
      }
    } else {
      // Open VideoModal for videos/animations
      setExpandedIndex(index)
    }
  }

  const closeVideoModal = () => {
    setExpandedIndex(null)
  }

  const closeLightbox = () => {
    setLightboxOpen(false)
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

      {/* PhotoSwipe lightbox for photos */}
      <Lightbox
        items={lightboxItems()}
        index={lightboxIndex()}
        open={lightboxOpen()}
        onClose={closeLightbox}
      />

      {/* VideoModal for videos */}
      <Show when={expandedIndex() !== null && isExpandedVideo()}>
        <Portal>
          <VideoModal
            url={expandedMediaQuery.data}
            isLoading={expandedMediaQuery.isLoading}
            onClose={closeVideoModal}
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

  // Load large thumbnail for inline display
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
      { rootMargin: '600px', threshold: 0 }
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
      {/* Base layer: thumbnail with blur */}
      <Show when={props.item.media.thumb} fallback={<div class="absolute inset-0 skeleton" />}>
        <img
          src={props.item.media.thumb}
          alt=""
          class={`absolute inset-0 w-full h-full object-cover blur-sm scale-105 transition-opacity duration-300 ${
            mediaQuery.data ? 'opacity-0' : 'opacity-100'
          }`}
          loading="lazy"
          decoding="async"
          width={props.item.media.width || MEDIA.DEFAULT_WIDTH}
          height={props.item.media.height || MEDIA.DEFAULT_HEIGHT}
        />
      </Show>
      
      {/* Top layer: full media - always rendered to prevent re-mount flickering */}
      <Show
        when={isAnimation()}
        fallback={
          <img
            src={mediaQuery.data || ''}
            alt={`Media ${mediaType()}`}
            class={`w-full h-full object-cover hover:scale-[1.02] transition-all duration-300 ${
              mediaQuery.data ? 'opacity-100' : 'opacity-0'
            }`}
            loading="lazy"
            decoding="async"
            width={props.item.media.width || MEDIA.DEFAULT_WIDTH}
            height={props.item.media.height || MEDIA.DEFAULT_HEIGHT}
          />
        }
      >
        <video
          src={mediaQuery.data || ''}
          class={`w-full h-full object-cover transition-opacity duration-300 ${
            mediaQuery.data ? 'opacity-100' : 'opacity-0'
          }`}
          autoplay
          muted
          loop
          playsinline
          preload="metadata"
          poster={props.item.media.thumb}
        />
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
