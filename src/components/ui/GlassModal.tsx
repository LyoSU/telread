import { type ParentProps, Show, createEffect, onCleanup, createSignal } from 'solid-js'
import { Portal } from 'solid-js/web'
import { Motion, Presence } from 'solid-motionone'
import { X } from 'lucide-solid'
import { haptic, lockScroll, unlockScroll } from '@/lib/utils'

function ModalHeader(props: { title: string; onClose: () => void; compact?: boolean }) {
  return (
    <div class={`flex items-center justify-between px-6 ${props.compact ? 'py-3' : 'py-5'} border-b border-[var(--glass-border)]`}>
      <h2 class="text-lg font-semibold text-primary">{props.title}</h2>
      <button onClick={() => { haptic('light'); props.onClose() }} class="pill p-2.5">
        <X size={16} />
      </button>
    </div>
  )
}

interface GlassModalProps extends ParentProps {
  open: boolean
  onClose: () => void
  title?: string
  /** Modal style: 'sheet' (bottom sheet, default) or 'center' (traditional centered) */
  variant?: 'sheet' | 'center'
  size?: 'sm' | 'md' | 'lg' | 'full'
}

const sizeStyles = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  full: 'max-w-4xl',
}

/**
 * GlassModal - iOS-style bottom sheet or centered modal
 *
 * Features:
 * - Bottom sheet (default): Slides up from bottom with drag indicator
 * - Centered: Traditional modal for desktop
 * - Smooth animations with solid-motionone
 * - Haptic feedback on open/close
 * - Escape key and backdrop click to close
 * - Drag to dismiss (for sheet variant)
 */
export function GlassModal(props: GlassModalProps) {
  const [dragY, setDragY] = createSignal(0)
  const [isDragging, setIsDragging] = createSignal(false)
  let startY = 0

  const isSheet = () => props.variant !== 'center'

  createEffect(() => {
    if (!props.open) return

    haptic('light')

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        haptic('light')
        props.onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    lockScroll()

    onCleanup(() => {
      document.removeEventListener('keydown', handleEscape)
      unlockScroll()
    })
  })

  // Touch handlers for drag-to-dismiss
  const handleTouchStart = (e: TouchEvent) => {
    if (!isSheet()) return
    startY = e.touches[0].clientY
    setIsDragging(true)
  }

  const handleTouchMove = (e: TouchEvent) => {
    if (!isDragging() || !isSheet()) return
    const currentY = e.touches[0].clientY
    const diff = currentY - startY
    // Only allow dragging down
    if (diff > 0) {
      setDragY(diff)
    }
  }

  const handleTouchEnd = () => {
    if (!isSheet()) return
    setIsDragging(false)
    // If dragged more than 100px, close the modal
    if (dragY() > 100) {
      haptic('light')
      props.onClose()
    }
    setDragY(0)
  }

  const handleBackdropClick = () => {
    haptic('light')
    props.onClose()
  }

  return (
    <Portal>
      <Presence>
        <Show when={props.open}>
          {/* Backdrop */}
          <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            onClick={handleBackdropClick}
          />

          {/* Modal */}
          <Show
            when={isSheet()}
            fallback={
              /* Centered modal variant */
              <div class="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
                <Motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  transition={{ duration: 0.2, easing: 'ease-out' }}
                  class={`
                    w-full ${sizeStyles[props.size ?? 'md']}
                    glass-elevated rounded-3xl
                    pointer-events-auto
                    max-h-[85vh] overflow-hidden flex flex-col
                  `}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Show when={props.title}>
                    <ModalHeader title={props.title!} onClose={props.onClose} />
                  </Show>
                  <div class="flex-1 overflow-y-auto custom-scrollbar p-6">
                    {props.children}
                  </div>
                </Motion.div>
              </div>
            }
          >
            {/* Bottom sheet variant */}
            <div class="fixed inset-x-0 bottom-0 z-50 pointer-events-none">
              <Motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ duration: 0.3, easing: [0.32, 0.72, 0, 1] }}
                class={`
                  w-full max-w-lg mx-auto
                  glass-elevated rounded-t-3xl
                  pointer-events-auto
                  max-h-[90vh] overflow-hidden flex flex-col
                  safe-bottom
                `}
                style={{
                  transform: dragY() > 0 ? `translateY(${dragY()}px)` : undefined,
                  transition: isDragging() ? 'none' : 'transform 0.2s ease-out',
                }}
                onClick={(e) => e.stopPropagation()}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
              >
                {/* Drag indicator */}
                <div class="flex justify-center pt-3 pb-2">
                  <div class="w-9 h-1 rounded-full bg-[var(--color-text-tertiary)] opacity-40" />
                </div>

                {/* Header */}
                <Show when={props.title}>
                  <ModalHeader title={props.title!} onClose={props.onClose} compact />
                </Show>

                {/* Content */}
                <div class="flex-1 overflow-y-auto custom-scrollbar p-6 pb-8">
                  {props.children}
                </div>
              </Motion.div>
            </div>
          </Show>
        </Show>
      </Presence>
    </Portal>
  )
}
