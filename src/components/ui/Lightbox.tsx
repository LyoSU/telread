import { onCleanup, createEffect } from 'solid-js'
import PhotoSwipe from 'photoswipe'
import 'photoswipe/style.css'

export interface LightboxItem {
  src: string
  width: number
  height: number
  thumb?: string
  alt?: string
  type?: 'image' | 'video'
}

export interface LightboxProps {
  items: LightboxItem[]
  index: number
  open: boolean
  onClose: () => void
}

/**
 * PhotoSwipe-based lightbox for images and videos
 */
export function Lightbox(props: LightboxProps) {
  let pswp: PhotoSwipe | null = null

  const openLightbox = () => {
    if (pswp || !props.open || props.items.length === 0) return

    const dataSource = props.items.map((item) => ({
      src: item.src,
      width: item.width || 1200,
      height: item.height || 800,
      alt: item.alt || '',
      msrc: item.thumb || '',
      type: item.type || 'image',
    }))

    pswp = new PhotoSwipe({
      dataSource,
      index: props.index,
      closeOnVerticalDrag: true,
      showHideAnimationType: 'fade',
      paddingFn: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
      maxZoomLevel: 4,
      pinchToClose: true,
      bgClickAction: 'close',
      tapAction: 'toggle-controls',
      doubleTapAction: 'zoom',
    })

    pswp.on('close', () => {
      pswp = null
      props.onClose()
    })

    // Video support
    pswp.on('contentLoad', (e) => {
      const { content } = e
      if (content.data.type === 'video' && content.data.src) {
        e.preventDefault()
        
        const video = document.createElement('video')
        video.src = content.data.src as string
        video.controls = true
        video.autoplay = true
        video.playsInline = true
        video.style.cssText = 'width: 100%; height: 100%; object-fit: contain; background: #000;'
        
        ;(content as any).element = video
      }
    })

    pswp.on('contentActivate', ({ content }) => {
      if (content.data.type === 'video' && content.element instanceof HTMLVideoElement) {
        content.element.play().catch(() => {})
      }
    })

    pswp.on('contentDeactivate', ({ content }) => {
      if (content.data.type === 'video' && content.element instanceof HTMLVideoElement) {
        content.element.pause()
      }
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

  // No container needed - PhotoSwipe appends to body
  return null
}

/**
 * Imperative lightbox API
 */
export function createLightbox() {
  let pswp: PhotoSwipe | null = null

  const open = (items: LightboxItem[], index = 0) => {
    if (pswp) {
      pswp.close()
    }

    const dataSource = items.map((item) => ({
      src: item.src,
      width: item.width || 1200,
      height: item.height || 800,
      alt: item.alt || '',
      msrc: item.thumb || '',
      type: item.type || 'image',
    }))

    pswp = new PhotoSwipe({
      dataSource,
      index,
      closeOnVerticalDrag: true,
      showHideAnimationType: 'fade',
      paddingFn: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
      maxZoomLevel: 4,
      pinchToClose: true,
      bgClickAction: 'close',
      tapAction: 'toggle-controls',
      doubleTapAction: 'zoom',
    })

    // Video support
    pswp.on('contentLoad', (e) => {
      const { content } = e
      if (content.data.type === 'video' && content.data.src) {
        e.preventDefault()
        
        const video = document.createElement('video')
        video.src = content.data.src as string
        video.controls = true
        video.autoplay = true
        video.playsInline = true
        video.style.cssText = 'width: 100%; height: 100%; object-fit: contain; background: #000;'
        
        ;(content as any).element = video
      }
    })

    pswp.on('contentActivate', ({ content }) => {
      if (content.data.type === 'video' && content.element instanceof HTMLVideoElement) {
        content.element.play().catch(() => {})
      }
    })

    pswp.on('contentDeactivate', ({ content }) => {
      if (content.data.type === 'video' && content.element instanceof HTMLVideoElement) {
        content.element.pause()
      }
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
