/* @refresh reload */
import { render } from 'solid-js/web'
import { registerSW } from 'virtual:pwa-register'
import '@/styles/index.css'
import App from './App'
import { cacheReadyPromise } from '@/lib/query/client'
import { updateStore } from '@/lib/store'

// Safety net for SolidJS cleanNode errors during navigation
// These shouldn't occur with proper cleanup, but suppress them just in case
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.message?.includes('cleanNode') ||
      event.reason?.stack?.includes('cleanNode')) {
    event.preventDefault()
  }
})

window.addEventListener('error', (event) => {
  if (event.message?.includes("reading '24'") ||
      event.error?.stack?.includes('cleanNode')) {
    event.preventDefault()
  }
})

const root = document.getElementById('root')

if (!root) {
  throw new Error('Root element not found')
}

// Wait for cache to restore, then render
// This ensures cached posts show immediately instead of skeleton
cacheReadyPromise.then(() => {
  render(() => <App />, root)

  // Remove splash after render
  requestAnimationFrame(() => {
    const splash = document.getElementById('splash')
    if (splash) {
      splash.style.transition = 'opacity 150ms ease-out'
      splash.style.opacity = '0'
      setTimeout(() => splash.remove(), 150)
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
      }, 60 * 60 * 1000)
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
