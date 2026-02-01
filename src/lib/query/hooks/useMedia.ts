import { createQuery } from '@tanstack/solid-query'
import { downloadMedia, downloadProfilePhoto } from '@/lib/telegram'
import { isFloodWait } from '@/lib/telegram/errors'
import { queryKeys } from '../keys'

/**
 * Custom retry logic for media downloads:
 * - FLOOD_WAIT: retry with exact wait time from Telegram
 * - Other errors: use default exponential backoff (max 2 retries)
 */
function shouldRetryMedia(failureCount: number, error: unknown): boolean {
  // FLOOD_WAIT: retry up to 2 times, but only if wait is reasonable (< 60s)
  if (isFloodWait(error)) {
    return failureCount < 2 && error.seconds < 60
  }
  // Other errors: retry up to 2 times
  return failureCount < 2
}

/**
 * Custom retry delay for media downloads:
 * - FLOOD_WAIT: wait exactly as long as Telegram requires + 1s buffer
 * - Other errors: exponential backoff
 */
function getRetryDelay(failureCount: number, error: unknown): number {
  if (isFloodWait(error)) {
    // Wait the required time + 1 second buffer
    return (error.seconds + 1) * 1000
  }
  // Exponential backoff: 1s, 2s, 4s... max 30s
  return Math.min(1000 * 2 ** failureCount, 30000)
}

/**
 * Hook to download media from a message
 *
 * @param size - 'small' (100x100), 'medium' (320x320), 'large' (800x800), or undefined for full resolution
 */
export function useMedia(
  channelId: () => number,
  messageId: () => number,
  size?: () => 'small' | 'medium' | 'large' | undefined,
  enabled?: () => boolean
) {
  return createQuery(() => ({
    queryKey: queryKeys.media.download(channelId(), messageId(), size?.() ?? 'full'),
    queryFn: () => downloadMedia(channelId(), messageId(), size?.()),
    staleTime: 1000 * 60 * 30, // 30 min - media rarely changes
    gcTime: 1000 * 60 * 10, // 10 min in memory (blob URLs are session-only anyway)
    retry: shouldRetryMedia,
    retryDelay: getRetryDelay,
    // Don't fetch for invalid IDs (client readiness checked in queryFn after cache check)
    enabled: (enabled?.() ?? true) && channelId() !== 0 && messageId() !== 0,
  }))
}

/**
 * Hook to download a profile photo
 * Cache is checked in downloadProfilePhoto: RAM -> IndexedDB -> API
 */
export function useProfilePhoto(
  peerId: () => number,
  size: 'small' | 'big' = 'small',
  enabled?: () => boolean
) {
  return createQuery(() => ({
    queryKey: queryKeys.media.profile(peerId(), size),
    queryFn: () => downloadProfilePhoto(peerId(), size),
    staleTime: Infinity, // Never stale - cache checked in queryFn
    gcTime: 1000 * 60 * 60, // 1 hour in query cache
    retry: shouldRetryMedia,
    retryDelay: getRetryDelay,
    refetchOnMount: false, // Don't refetch - downloadProfilePhoto checks IndexedDB
    enabled: (enabled?.() ?? true) && peerId() !== 0,
  }))
}
