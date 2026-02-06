import { createSignal } from 'solid-js'

/**
 * Global home-tap signal — increments when user taps the home button
 * while already on the home page. Home.tsx watches this to trigger
 * scroll-to-top + refresh.
 */
const [homeTapTrigger, setHomeTapTrigger] = createSignal(0)

export { homeTapTrigger }

export function triggerHomeTap() {
  setHomeTapTrigger((c) => c + 1)
}
