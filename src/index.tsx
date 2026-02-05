/* @refresh reload */
import { render } from 'solid-js/web'
import { registerSW } from 'virtual:pwa-register'
import '@/styles/index.css'
import App from './App'
import { cacheReadyPromise } from '@/lib/query/client'
import { updateStore } from '@/lib/store'
import { TIMING } from '@/config/constants'

// Safety net for SolidJS internal cleanNode errors during navigation
// Only suppress the specific SolidJS cleanup TypeError, log everything else
window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.message
  if (typeof msg === 'string' && msg.includes('cleanNode')) {
    event.preventDefault()
    if (import.meta.env.DEV) console.debug('[Suppressed] SolidJS cleanNode rejection:', msg)
  }
})

const root = document.getElementById('root')

if (!root) {
  throw new Error('Root element not found')
}

// Wait for cache to restore (with timeout), then render
// This ensures cached posts show immediately instead of skeleton
// Timeout prevents infinite hang if IndexedDB is corrupted/locked
Promise.race([
  cacheReadyPromise,
  new Promise<void>(resolve => setTimeout(resolve, 3000)),
]).then(() => {
  render(() => <App />, root)

  // Remove splash after render
  requestAnimationFrame(() => {
    const splash = document.getElementById('splash')
    if (splash) {
      splash.style.transition = `opacity ${TIMING.SPLASH_FADE_DELAY}ms ease-out`
      splash.style.opacity = '0'
      setTimeout(() => splash.remove(), TIMING.SPLASH_FADE_DELAY)
    }
  })
})

// Register service worker with manual update control
// User decides when to apply updates for security
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // New version available - update store directly (no race condition)
    updateStore.markUpdateAvailable()
  },
  onRegisteredSW(_swUrl, registration) {
    // Check for updates every hour (downloads only, doesn't apply)
    if (registration) {
      setInterval(() => {
        registration.update()
      }, TIMING.SW_UPDATE_INTERVAL)
    }
  },
})

// Expose updateSW globally for the update prompt to use
declare global {
  interface Window {
    __swUpdate?: (reloadPage?: boolean) => Promise<void>
  }
}
window.__swUpdate = updateSW
