import { onCleanup, createEffect } from 'solid-js'
import PhotoSwipe from 'photoswipe'
import 'photoswipe/style.css'

export interface LightboxItem {
  src: string
  width: number
  height: number
  thumb?: string
  alt?: string
}

export interface LightboxProps {
  items: LightboxItem[]
  index: number
  open: boolean
  onClose: () => void
}

/**
 * PhotoSwipe configuration for the app
 */
const PSWP_OPTIONS = {
  closeOnVerticalDrag: true,
  showHideAnimationType: 'fade' as const,
  paddingFn: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  maxZoomLevel: 4,
  pinchToClose: true,
  bgClickAction: 'close' as const,
  tapAction: 'toggle-controls' as const,
  doubleTapAction: 'zoom' as const,
}

/**
 * Convert LightboxItem to PhotoSwipe data format
 */
function toDataSource(items: LightboxItem[]) {
  return items.map((item) => ({
    src: item.src,
    width: item.width || 1200,
    height: item.height || 800,
    alt: item.alt || '',
    msrc: item.thumb || '',
  }))
}

/**
 * PhotoSwipe-based lightbox for images
 * Features: pinch-to-zoom, swipe navigation, double-tap zoom
 */
export function Lightbox(props: LightboxProps) {
  let pswp: PhotoSwipe | null = null

  const openLightbox = () => {
    if (pswp || !props.open || props.items.length === 0) return

    pswp = new PhotoSwipe({
      dataSource: toDataSource(props.items),
      index: props.index,
      ...PSWP_OPTIONS,
    })

    pswp.on('close', () => {
      pswp = null
      props.onClose()
    })

    pswp.init()
  }

  const closeLightbox = () => {
    if (pswp) {
      pswp.close()
      pswp = null
    }
  }

  createEffect(() => {
    if (props.open) {
      requestAnimationFrame(() => openLightbox())
    } else {
      closeLightbox()
    }
  })

  onCleanup(() => {
    closeLightbox()
  })

  return null
}

/**
 * Imperative lightbox API for opening from callbacks
 */
export function createLightbox() {
  let pswp: PhotoSwipe | null = null

  const open = (items: LightboxItem[], index = 0) => {
    if (pswp) {
      pswp.close()
    }

    pswp = new PhotoSwipe({
      dataSource: toDataSource(items),
      index,
      ...PSWP_OPTIONS,
    })

    pswp.on('close', () => {
      pswp = null
    })

    pswp.init()
    return pswp
  }

  const close = () => {
    if (pswp) {
      pswp.close()
      pswp = null
    }
  }

  return { open, close }
}
