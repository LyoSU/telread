import { onCleanup, createEffect } from 'solid-js'
import type PhotoSwipeType from 'photoswipe'

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
 * Lazy load PhotoSwipe and its CSS
 */
let PhotoSwipe: typeof PhotoSwipeType | null = null

async function loadPhotoSwipe() {
  if (!PhotoSwipe) {
    const [pswp] = await Promise.all([
      import('photoswipe'),
      import('photoswipe/style.css'),
    ])
    PhotoSwipe = pswp.default
  }
  return PhotoSwipe
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
  let pswp: PhotoSwipeType | null = null

  const openLightbox = async () => {
    if (pswp || !props.open || props.items.length === 0) return

    const PSWP = await loadPhotoSwipe()
    pswp = new PSWP({
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

  let rafId: number | undefined

  createEffect(() => {
    if (props.open) {
      rafId = requestAnimationFrame(() => openLightbox())
    } else {
      closeLightbox()
    }
  })

  onCleanup(() => {
    if (rafId !== undefined) cancelAnimationFrame(rafId)
    closeLightbox()
  })

  return null
}

/**
 * Imperative lightbox API for opening from callbacks
 */
export function createLightbox() {
  let pswp: PhotoSwipeType | null = null

  const open = async (items: LightboxItem[], index = 0) => {
    if (pswp) {
      pswp.close()
    }

    const PSWP = await loadPhotoSwipe()
    pswp = new PSWP({
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
