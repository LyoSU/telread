/**
 * Activity tracking - records when user was last active
 *
 * Used for:
 * - Logging/debugging (see how long user was away)
 * - Potential future optimizations based on absence duration
 *
 * The actual sync strategy relies on mtcute's built-in catchUp mechanism
 * which handles missed updates automatically.
 */

import { TIMING } from '@/config/constants'

const STORAGE_KEY = 'telread:lastActive'

/**
 * Update last active timestamp to now
 * Call this periodically while app is active
 */
export function updateLastActive(): void {
  try {
    localStorage.setItem(STORAGE_KEY, Date.now().toString())
  } catch {
    // Ignore storage errors
  }
}

/**
 * Start periodic activity updates
 * Updates every 5 minutes while app is active
 */
export function startActivityTracking(): () => void {
  // Update immediately on start
  updateLastActive()

  // Update periodically
  const intervalId = setInterval(updateLastActive, TIMING.ACTIVITY_UPDATE_INTERVAL)
  
  // Update on visibility change (when tab becomes visible)
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      updateLastActive()
    }
  }
  document.addEventListener('visibilitychange', handleVisibility)
  
  // Update before page unload
  const handleUnload = () => updateLastActive()
  window.addEventListener('beforeunload', handleUnload)
  
  // Return cleanup function
  return () => {
    clearInterval(intervalId)
    document.removeEventListener('visibilitychange', handleVisibility)
    window.removeEventListener('beforeunload', handleUnload)
  }
}

