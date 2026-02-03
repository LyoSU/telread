import { createMemo } from 'solid-js'
import { formatTimeAgo, formatRelativeTime, globalNow } from '@/lib/utils'

interface TimeAgoProps {
  date: Date | string
  class?: string
  /** Use relative format ("5m ago") instead of compact ("5m") */
  relative?: boolean
}

/**
 * Isolated TimeAgo component
 * 
 * Updates independently when globalNow changes (every 60s),
 * without causing parent components to re-render.
 * This prevents media flickering when time updates.
 */
export function TimeAgo(props: TimeAgoProps) {
  const timeAgo = createMemo(() => {
    globalNow() // Subscribe to time updates
    return props.relative 
      ? formatRelativeTime(props.date)
      : formatTimeAgo(props.date)
  })

  return <span class={props.class}>{timeAgo()}</span>
}
