import { type ParentProps, createEffect, createSignal, on } from 'solid-js'
import { useLocation } from '@solidjs/router'

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

  // Watch for route changes
  createEffect(
    on(
      () => location.pathname,
      (newPath) => {
        if (newPath !== currentPath()) {
          // Start fade out
          setIsVisible(false)
          
          // After fade out, update path and fade in
          setTimeout(() => {
            setCurrentPath(newPath)
            setIsVisible(true)
          }, 150) // Match CSS transition duration
        }
      },
      { defer: true }
    )
  )

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
