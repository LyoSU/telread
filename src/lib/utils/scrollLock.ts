/**
 * Centralized scroll lock with reference counting.
 * Multiple modals can lock/unlock independently without conflicting.
 */
let lockCount = 0

export function lockScroll(): void {
  lockCount++
  if (lockCount === 1) {
    document.body.style.overflow = 'hidden'
  }
}

export function unlockScroll(): void {
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount === 0) {
    document.body.style.overflow = ''
  }
}
