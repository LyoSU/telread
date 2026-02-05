import { createSignal, Show, onMount, onCleanup } from 'solid-js'
import { X, RefreshCw } from 'lucide-solid'
import { lockScroll, unlockScroll } from '@/lib/utils'

interface VideoModalProps {
  url: string | null | undefined
  isLoading?: boolean
  isError?: boolean
  isRound?: boolean
  onClose: () => void
  onRetry?: () => void
}

// Module-level flag: signals that a previous VideoModal is cleaning up
// and its history.back() will fire a stale popstate event
let cleanupPending = false

/**
 * Fullscreen video modal with native controls
 * Features:
 * - Native video controls (play, pause, seek, volume, fullscreen)
 * - Swipe down to close
 * - Back button handling
 * - Esc key to close
 * - Error state with retry
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
    // Skip stale popstate events from a previous instance's cleanup
    if (cleanupPending) {
      cleanupPending = false
      return
    }
    closedByBack = true
    props.onClose()
  }

  const close = () => {
    if (closedByBack) {
      props.onClose()
    } else {
      // Closing via X button or swipe - history.back() will trigger popstate -> onClose
      history.back()
    }
  }

  onMount(() => {
    // Clear stale flag if it survived from a previous instance
    cleanupPending = false
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
      // Signal to skip the stale popstate in any new instance
      cleanupPending = true
      history.back()
      // Auto-clear if no new instance picks it up
      setTimeout(() => { cleanupPending = false }, 100)
    }
  })

  const opacity = () => Math.max(0, 1 - offsetY() / 300)

  // Only allow backdrop-close when video is loaded (prevents accidental close during loading)
  const handleBackdropClick = () => {
    if (props.url) close()
  }

  return (
    <div
      class="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ 'background-color': `rgba(0, 0, 0, ${opacity()})` }}
      onClick={handleBackdropClick}
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
            <>
              {/* Loading spinner */}
              <Show when={props.isLoading}>
                <div class="animate-spin w-10 h-10 border-2 border-white border-t-transparent rounded-full" />
              </Show>

              {/* Error state with retry */}
              <Show when={props.isError && !props.isLoading}>
                <div class="flex flex-col items-center gap-4 text-white">
                  <p class="text-sm text-white/70">Failed to load video</p>
                  <Show when={props.onRetry}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onRetry?.()
                      }}
                      class="flex items-center gap-2 px-4 py-2 rounded-full bg-white/15 hover:bg-white/25 text-sm font-medium transition-colors"
                    >
                      <RefreshCw size={16} />
                      Retry
                    </button>
                  </Show>
                </div>
              </Show>
            </>
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
