import { createSignal, createRoot } from 'solid-js'

/**
 * Update store - tracks app update availability
 * 
 * Used by:
 * - UpdatePrompt (toast notification)
 * - Settings page (manual update button)
 * - Navigation (badge indicator)
 */
function createUpdateStore() {
  const [updateAvailable, setUpdateAvailable] = createSignal(false)
  const [isUpdating, setIsUpdating] = createSignal(false)
  // Track if user dismissed the toast this session
  const [dismissed, setDismissed] = createSignal(false)

  const markUpdateAvailable = () => {
    setUpdateAvailable(true)
  }

  const dismissPrompt = () => {
    setDismissed(true)
  }

  const applyUpdate = async () => {
    if (isUpdating()) return
    
    setIsUpdating(true)
    try {
      await window.__swUpdate?.()
      window.location.reload()
    } catch (error) {
      console.error('[UpdateStore] Failed to apply update:', error)
      setIsUpdating(false)
    }
  }

  // Check if we should show the toast
  // (update available AND not dismissed this session)
  const shouldShowPrompt = () => updateAvailable() && !dismissed()

  return {
    get updateAvailable() {
      return updateAvailable()
    },
    get isUpdating() {
      return isUpdating()
    },
    get shouldShowPrompt() {
      return shouldShowPrompt()
    },
    markUpdateAvailable,
    dismissPrompt,
    applyUpdate,
  }
}

export const updateStore = createRoot(createUpdateStore)
