import { createSignal, Show, onMount, onCleanup } from 'solid-js'
import { X } from 'lucide-solid'
import { lockScroll, unlockScroll } from '@/lib/utils'

interface VideoModalProps {
  url: string | null | undefined
  isLoading?: boolean
  isRound?: boolean
  onClose: () => void
}

/**
 * Fullscreen video modal with native controls
 * Features:
 * - Native video controls (play, pause, seek, volume, fullscreen)
 * - Swipe down to close
 * - Back button handling
 * - Esc key to close
 */
export function VideoModal(props: VideoModalProps) {
  let closedByBack = false
  let touchStartY = 0
  const [offsetY, setOffsetY] = createSignal(0)

  const handleTouchStart = (e: TouchEvent) => {
    touchStartY = e.touches[0].clientY
  }

  const handleTouchMove = (e: TouchEvent) => {
    const deltaY = e.touches[0].clientY - touchStartY
    if (deltaY > 0) {
      setOffsetY(deltaY)
      e.preventDefault()
    }
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
    if (closedByBack) {
      // Already closing via back button - just call onClose
      props.onClose()
    } else {
      // Closing via X button or swipe - history.back() will trigger popstate -> onClose
      history.back()
    }
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown)
    lockScroll()
    history.pushState({ modal: 'video' }, '')
    window.addEventListener('popstate', handlePopState)
  })

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('popstate', handlePopState)
    unlockScroll()
    // If modal is being unmounted without going through back button,
    // remove the history entry we pushed to prevent broken navigation
    if (!closedByBack && history.state?.modal === 'video') {
      history.back()
    }
  })

  const opacity = () => Math.max(0, 1 - offsetY() / 300)

  return (
    <div
      class="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ 'background-color': `rgba(0, 0, 0, ${opacity()})` }}
      onClick={close}
    >
      {/* Close button */}
      <button
        type="button"
        aria-label="Close"
        class="absolute top-4 right-4 p-2 text-white/70 hover:text-white z-20 transition-colors"
        style={{ 'margin-top': 'env(safe-area-inset-top, 0)' }}
        onClick={(e) => {
          e.stopPropagation()
          close()
        }}
      >
        <X size={32} />
      </button>

      {/* Video container */}
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
              class={`max-w-full max-h-full bg-black ${props.isRound ? 'rounded-full' : ''}`}
              controls
              autoplay
              playsinline
              preload="auto"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </Show>
      </div>
    </div>
  )
}
