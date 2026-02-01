import { createSignal, onMount, onCleanup, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { Motion, Presence } from 'solid-motionone'
import { RefreshCw, X } from 'lucide-solid'
import { GlassButton } from './GlassButton'

/**
 * Update prompt - shown when a new version is available
 * 
 * User controls when to apply updates for security.
 * Updates are downloaded in background, but only applied when user confirms.
 */
export function UpdatePrompt() {
  const [showPrompt, setShowPrompt] = createSignal(false)
  const [isUpdating, setIsUpdating] = createSignal(false)

  const handleUpdateAvailable = () => {
    setShowPrompt(true)
  }

  const handleUpdate = async () => {
    setIsUpdating(true)
    try {
      // Call the SW update function exposed on window
      await window.__swUpdate?.()
      // Reload to activate new version
      window.location.reload()
    } catch (error) {
      console.error('[UpdatePrompt] Failed to update:', error)
      setIsUpdating(false)
    }
  }

  const handleDismiss = () => {
    setShowPrompt(false)
  }

  onMount(() => {
    window.addEventListener('sw-update-available', handleUpdateAvailable)
  })

  onCleanup(() => {
    window.removeEventListener('sw-update-available', handleUpdateAvailable)
  })

  return (
    <Portal>
      <Presence>
        <Show when={showPrompt()}>
          <Motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            class="fixed bottom-20 left-4 right-4 z-50 sm:left-auto sm:right-4 sm:max-w-sm"
          >
            <div class="glass-elevated rounded-2xl p-4 shadow-lg">
              <div class="flex items-start gap-3">
                {/* Icon */}
                <div class="w-10 h-10 rounded-full bg-[var(--accent)]/15 flex items-center justify-center flex-shrink-0">
                  <RefreshCw size={20} class="text-accent" />
                </div>

                {/* Content */}
                <div class="flex-1 min-w-0">
                  <p class="font-medium text-primary text-sm">
                    Update available
                  </p>
                  <p class="text-xs text-secondary mt-0.5">
                    A new version is ready to install
                  </p>
                </div>

                {/* Dismiss */}
                <button
                  onClick={handleDismiss}
                  class="p-1 rounded-full hover:bg-[var(--pill-bg)] transition-colors"
                  aria-label="Dismiss"
                >
                  <X size={16} class="text-tertiary" />
                </button>
              </div>

              {/* Actions */}
              <div class="flex gap-2 mt-3">
                <GlassButton
                  variant="ghost"
                  size="sm"
                  class="flex-1"
                  onClick={handleDismiss}
                >
                  Later
                </GlassButton>
                <GlassButton
                  variant="primary"
                  size="sm"
                  class="flex-1"
                  onClick={handleUpdate}
                  disabled={isUpdating()}
                >
                  {isUpdating() ? 'Updating...' : 'Update now'}
                </GlassButton>
              </div>
            </div>
          </Motion.div>
        </Show>
      </Presence>
    </Portal>
  )
}
