import { createQuery } from '@tanstack/solid-query'
import { downloadMedia, downloadProfilePhoto } from '@/lib/telegram'
import type { MediaPriority } from '@/lib/telegram'
import { isFloodWait } from '@/lib/telegram/errors'
import { isMobile } from '@/config/constants'
import { queryKeys } from '../keys'

/**
 * Custom retry logic for media downloads:
 * - FLOOD_WAIT: retry with exact wait time from Telegram
 * - Other errors: retry up to 3 times for better reliability
 */
function shouldRetryMedia(failureCount: number, error: unknown): boolean {
  // FLOOD_WAIT: retry up to 2 times, but only if wait is reasonable (< 30s)
  if (isFloodWait(error)) {
    return failureCount < 2 && error.seconds < 30
  }
  // Other errors: retry up to 3 times for better reliability
  return failureCount < 3
}

/**
 * Custom retry delay for media downloads:
 * - FLOOD_WAIT: wait exactly as long as Telegram requires + small buffer
 * - Other errors: fast retry with small backoff
 */
function getRetryDelay(failureCount: number, error: unknown): number {
  if (isFloodWait(error)) {
    // Wait the required time + 0.5 second buffer
    return (error.seconds + 0.5) * 1000
  }
  // Faster backoff: 500ms, 1s, 2s... max 5s
  return Math.min(500 * 2 ** failureCount, 5000)
}

/**
 * Hook to download media from a message
 *
 * @param size - 'small' (100x100), 'medium' (320x320), 'large' (800x800), or undefined for full resolution
 * @param priority - Download priority: 'high' for visible, 'normal' for prefetch, 'low' for background
 */
export function useMedia(
  channelId: () => number,
  messageId: () => number,
  size?: () => 'small' | 'medium' | 'large' | undefined,
  enabled?: () => boolean,
  priority?: () => MediaPriority
) {
  return createQuery(() => ({
    queryKey: queryKeys.media.download(channelId(), messageId(), size?.() ?? 'full'),
    queryFn: () => downloadMedia(channelId(), messageId(), size?.(), undefined, priority?.() ?? 'high'),
    staleTime: 1000 * 60 * 30, // 30 min - media rarely changes
    gcTime: isMobile ? 1000 * 60 * 5 : 1000 * 60 * 10, // Mobile: 5min, Desktop: 10min
    retry: shouldRetryMedia,
    retryDelay: getRetryDelay,
    // Don't fetch for invalid IDs (client readiness checked in queryFn after cache check)
    enabled: (enabled?.() ?? true) && channelId() !== 0 && messageId() !== 0,
  }))
}

/**
 * Hook to download a profile photo
 * Cache is checked in downloadProfilePhoto: RAM -> IndexedDB -> API
 * 
 * @param priority - Download priority: 'high' for visible avatars
 */
export function useProfilePhoto(
  peerId: () => number,
  size: 'small' | 'big' = 'small',
  enabled?: () => boolean,
  priority?: () => MediaPriority
) {
  return createQuery(() => ({
    queryKey: queryKeys.media.profile(peerId(), size),
    queryFn: () => downloadProfilePhoto(peerId(), size, priority?.() ?? 'high'),
    staleTime: Infinity, // Never stale - cache checked in queryFn
    gcTime: isMobile ? 1000 * 60 * 15 : 1000 * 60 * 60, // Mobile: 15min, Desktop: 1hr
    retry: shouldRetryMedia,
    retryDelay: getRetryDelay,
    refetchOnMount: false, // Don't refetch - downloadProfilePhoto checks IndexedDB
    enabled: (enabled?.() ?? true) && peerId() !== 0,
  }))
}
