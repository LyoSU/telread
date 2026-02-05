import { type ParentProps, createEffect, createSignal, on, onCleanup } from 'solid-js'
import { useLocation } from '@solidjs/router'
import { TIMING } from '@/config/constants'

/**
 * PageTransition - Smooth fade transitions between routes
 * 
 * Uses CSS transitions for a native app feel.
 * Automatically triggers on route changes.
 */
export function PageTransition(props: ParentProps) {
  const location = useLocation()
  const [isVisible, setIsVisible] = createSignal(true)
  const [currentPath, setCurrentPath] = createSignal(location.pathname)
  let transitionTimer: ReturnType<typeof setTimeout> | undefined

  // Watch for route changes
  createEffect(
    on(
      () => location.pathname,
      (newPath) => {
        if (newPath !== currentPath()) {
          // Cancel any in-flight transition from a previous rapid route change
          clearTimeout(transitionTimer)

          // Start fade out
          setIsVisible(false)

          // After fade out, update path and fade in
          transitionTimer = setTimeout(() => {
            setCurrentPath(newPath)
            setIsVisible(true)
          }, TIMING.PAGE_TRANSITION_DELAY) // Match CSS transition duration
        }
      },
      { defer: true }
    )
  )

  onCleanup(() => clearTimeout(transitionTimer))

  return (
    <div
      class="page-transition"
      classList={{
        'page-visible': isVisible(),
        'page-hidden': !isVisible(),
      }}
    >
      {props.children}
    </div>
  )
}
