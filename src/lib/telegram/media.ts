import { getTelegramClient, isClientReady } from './client'
import { MEDIA_CACHE_MAX_SIZE } from '@/config/constants'
import { get, set, del, keys } from 'idb-keyval'
import type { Photo, Video, Document, Sticker, Audio, Voice, WebPageMedia } from '@mtcute/web'
import { isChannelInvalid, isFileReferenceExpired } from './errors'

// Union type for media that supports thumbnails
type MediaWithThumbnails = Photo | Video | Document | Sticker | Audio | Voice

// ============================================================================
// Stripped Thumbnail Utilities
// ============================================================================

// Standard JPEG header that Telegram strips to save bandwidth (~620 bytes)
// See: https://core.telegram.org/api/files#stripped-thumbnails
const JPEG_HEADER = /*#__PURE__*/ new Uint8Array([
  0xff,0xd8,0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46,0x00,0x01,0x01,0x00,0x00,0x01,
  0x00,0x01,0x00,0x00,0xff,0xdb,0x00,0x43,0x00,0x28,0x1c,0x1e,0x23,0x1e,0x19,0x28,
  0x23,0x21,0x23,0x2d,0x2b,0x28,0x30,0x3c,0x64,0x41,0x3c,0x37,0x37,0x3c,0x7b,0x58,
  0x5d,0x49,0x64,0x91,0x80,0x99,0x96,0x8f,0x80,0x8c,0x8a,0xa0,0xb4,0xe6,0xc3,0xa0,
  0xaa,0xda,0xad,0x8a,0x8c,0xc8,0xff,0xcb,0xda,0xee,0xf5,0xff,0xff,0xff,0x9b,0xc1,
  0xff,0xff,0xff,0xfa,0xff,0xe6,0xfd,0xff,0xf8,0xff,0xdb,0x00,0x43,0x01,0x2b,0x2d,
  0x2d,0x3c,0x35,0x3c,0x76,0x41,0x41,0x76,0xf8,0xa5,0x8c,0xa5,0xf8,0xf8,0xf8,0xf8,
  0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,
  0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,
  0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xf8,0xff,0xc0,
  0x00,0x11,0x08,0x00,0x00,0x00,0x00,0x03,0x01,0x22,0x00,0x02,0x11,0x01,0x03,0x11,
  0x01,0xff,0xc4,0x00,0x1f,0x00,0x00,0x01,0x05,0x01,0x01,0x01,0x01,0x01,0x01,0x00,
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,0x09,
  0x0a,0x0b,0xff,0xc4,0x00,0xb5,0x10,0x00,0x02,0x01,0x03,0x03,0x02,0x04,0x03,0x05,
  0x05,0x04,0x04,0x00,0x00,0x01,0x7d,0x01,0x02,0x03,0x00,0x04,0x11,0x05,0x12,0x21,
  0x31,0x41,0x06,0x13,0x51,0x61,0x07,0x22,0x71,0x14,0x32,0x81,0x91,0xa1,0x08,0x23,
  0x42,0xb1,0xc1,0x15,0x52,0xd1,0xf0,0x24,0x33,0x62,0x72,0x82,0x09,0x0a,0x16,0x17,
  0x18,0x19,0x1a,0x25,0x26,0x27,0x28,0x29,0x2a,0x34,0x35,0x36,0x37,0x38,0x39,0x3a,
  0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,
  0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,
  0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,
  0x9a,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,
  0xb8,0xb9,0xba,0xc2,0xc3,0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,
  0xd6,0xd7,0xd8,0xd9,0xda,0xe1,0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf1,
  0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,0xf9,0xfa,0xff,0xc4,0x00,0x1f,0x01,0x00,0x03,
  0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x01,
  0x02,0x03,0x04,0x05,0x06,0x07,0x08,0x09,0x0a,0x0b,0xff,0xc4,0x00,0xb5,0x11,0x00,
  0x02,0x01,0x02,0x04,0x04,0x03,0x04,0x07,0x05,0x04,0x04,0x00,0x01,0x02,0x77,0x00,
  0x01,0x02,0x03,0x11,0x04,0x05,0x21,0x31,0x06,0x12,0x41,0x51,0x07,0x61,0x71,0x13,
  0x22,0x32,0x81,0x08,0x14,0x42,0x91,0xa1,0xb1,0xc1,0x09,0x23,0x33,0x52,0xf0,0x15,
  0x62,0x72,0xd1,0x0a,0x16,0x24,0x34,0xe1,0x25,0xf1,0x17,0x18,0x19,0x1a,0x26,0x27,
  0x28,0x29,0x2a,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,0x46,0x47,0x48,0x49,
  0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x63,0x64,0x65,0x66,0x67,0x68,0x69,
  0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,0x82,0x83,0x84,0x85,0x86,0x87,0x88,
  0x89,0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,0xa2,0xa3,0xa4,0xa5,0xa6,
  0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xc2,0xc3,0xc4,
  0xc5,0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,0xe2,
  0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,0xf9,
  0xfa,0xff,0xda,0x00,0x0c,0x03,0x01,0x00,0x02,0x11,0x03,0x11,0x00,0x3f,0x00
])

/**
 * Convert stripped thumbnail bytes to data URL
 * Telegram strips JPEG header/footer to save ~620 bytes per thumbnail
 */
export function strippedToDataUrl(stripped: Uint8Array): string | undefined {
  if (stripped.length < 3 || stripped[0] !== 1) return undefined
  
  // Reconstruct JPEG: header + data + footer (0xff 0xd9)
  const jpeg = new Uint8Array(JPEG_HEADER.length + stripped.length - 3 + 2)
  jpeg.set(JPEG_HEADER)
  jpeg.set(stripped.subarray(3), JPEG_HEADER.length)
  jpeg[jpeg.length - 2] = 0xff
  jpeg[jpeg.length - 1] = 0xd9
  
  // Patch width/height into header
  jpeg[164] = stripped[1]
  jpeg[166] = stripped[2]
  
  // Convert to base64 data URL
  let binary = ''
  for (let i = 0; i < jpeg.length; i++) {
    binary += String.fromCharCode(jpeg[i])
  }
  return `data:image/jpeg;base64,${btoa(binary)}`
}

// ============================================================================
// LRU Cache for Media URLs
// ============================================================================

/**
 * LRU (Least Recently Used) cache for blob URLs
 * Automatically evicts oldest entries and revokes blob URLs to prevent memory leaks
 */
class MediaLRUCache {
  private cache = new Map<string, string>()
  private readonly maxSize: number

  constructor(maxSize: number) {
    this.maxSize = maxSize
  }

  get(key: string): string | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key)
      this.cache.set(key, value)
    }
    return value
  }

  set(key: string, value: string): void {
    // If key exists, check if value is the same
    if (this.cache.has(key)) {
      const oldValue = this.cache.get(key)
      if (oldValue === value) {
        // Same value - just update position (move to end)
        this.cache.delete(key)
        this.cache.set(key, value)
        return
      }
      // Different value - just remove from cache, don't revoke
      // Components may still be rendering the old blob URL
      this.cache.delete(key)
    }

    // Evict oldest entries if at capacity
    // NOTE: We intentionally do NOT revoke blob URLs here because React components
    // may still be rendering them. The browser will garbage collect blobs
    // automatically when there are no more references.
    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey) {
        this.cache.delete(oldestKey)
      }
    }

    this.cache.set(key, value)
  }

  has(key: string): boolean {
    return this.cache.has(key)
  }

  /**
   * Remove a specific entry and revoke its blob URL
   */
  delete(key: string): boolean {
    const value = this.cache.get(key)
    if (value) {
      URL.revokeObjectURL(value)
      return this.cache.delete(key)
    }
    return false
  }

  /**
   * Clear all entries and revoke all blob URLs
   */
  clear(): void {
    for (const url of this.cache.values()) {
      URL.revokeObjectURL(url)
    }
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

// ============================================================================
// Media Cache Instance
// ============================================================================

const mediaCache = new MediaLRUCache(MEDIA_CACHE_MAX_SIZE)

// ============================================================================
// Persistent Media Cache (IndexedDB)
// ============================================================================

const MEDIA_CACHE_PREFIX = 'media-thumb:'
const MEDIA_CACHE_VERSION = 2 // v2: binary data instead of base64
const MEDIA_CACHE_TTL = 1000 * 60 * 60 * 24 * 7 // 7 days

interface CachedMedia {
  data: Uint8Array // Binary data (IndexedDB supports this natively)
  mimeType: string
  timestamp: number
  version: number
}

/**
 * Get media thumbnail from persistent cache
 * Returns blob URL - reuses from memory cache if available to prevent leaks
 */
async function getCachedMediaThumbnail(
  channelId: number,
  messageId: number,
  size: string
): Promise<string | null> {
  const cacheKey = `${channelId}:${messageId}:${size}`

  // Check memory cache first to avoid creating duplicate blob URLs
  const memCached = mediaCache.get(cacheKey)
  if (memCached) return memCached

  try {
    const key = `${MEDIA_CACHE_PREFIX}${channelId}:${messageId}:${size}`
    const cached = await get<CachedMedia>(key)

    if (!cached) return null
    if (cached.version !== MEDIA_CACHE_VERSION) return null
    if (Date.now() - cached.timestamp > MEDIA_CACHE_TTL) return null

    // Check memory cache again (another request might have populated it)
    const memCachedAgain = mediaCache.get(cacheKey)
    if (memCachedAgain) return memCachedAgain

    // Create blob URL and store in memory cache
    const blob = new Blob([cached.data], { type: cached.mimeType })
    const url = URL.createObjectURL(blob)
    mediaCache.set(cacheKey, url)
    return url
  } catch {
    return null
  }
}

/**
 * Save media thumbnail to persistent cache (binary data)
 */
async function cacheMediaThumbnail(
  channelId: number,
  messageId: number,
  size: string,
  buffer: Uint8Array,
  mimeType: string
): Promise<void> {
  try {
    const key = `${MEDIA_CACHE_PREFIX}${channelId}:${messageId}:${size}`
    const cached: CachedMedia = {
      data: buffer, // Store binary directly
      mimeType,
      timestamp: Date.now(),
      version: MEDIA_CACHE_VERSION,
    }
    await set(key, cached)
  } catch {
    // Ignore cache errors
  }
}

// ============================================================================
// Persistent Profile Photo Cache (IndexedDB)
// ============================================================================

const PROFILE_CACHE_PREFIX = 'profile-photo:'
const PROFILE_CACHE_VERSION = 2 // v2: binary data instead of base64
const PROFILE_CACHE_TTL = 1000 * 60 * 60 * 24 * 7 // 7 days

// Simple cache for profile photo blob URLs with soft limit
// We don't aggressively revoke URLs because Avatar components may still reference them
// Instead, we just evict oldest entries when cache gets too large
// On page reload, this Map is cleared anyway
const MAX_PROFILE_PHOTO_CACHE = 200
const profilePhotoCache = new Map<string, string>()

function addToProfilePhotoCache(key: string, url: string): void {
  // Soft eviction when cache is too large - remove oldest 20%
  if (profilePhotoCache.size >= MAX_PROFILE_PHOTO_CACHE) {
    const toRemove = Math.floor(MAX_PROFILE_PHOTO_CACHE * 0.2)
    const keys = Array.from(profilePhotoCache.keys()).slice(0, toRemove)
    for (const k of keys) {
      // Don't revoke - components may still reference
      profilePhotoCache.delete(k)
    }
  }
  profilePhotoCache.set(key, url)
}

interface CachedProfilePhoto {
  data: Uint8Array // Binary data
  timestamp: number
  version: number
}

// Binary data is stored directly in IndexedDB - no base64 conversion needed

/**
 * Get profile photo from persistent cache
 * Returns blob URL - reuses from memory cache if available to prevent leaks
 */
async function getCachedProfilePhoto(peerId: number, size: string): Promise<string | null> {
  const cacheKey = `profile:${peerId}:${size}`

  // Check memory cache first to avoid creating duplicate blob URLs
  const memCached = profilePhotoCache.get(cacheKey)
  if (memCached) return memCached

  try {
    const key = `${PROFILE_CACHE_PREFIX}${peerId}:${size}`
    const cached = await get<CachedProfilePhoto>(key)

    if (!cached) return null

    // Check version and TTL
    if (cached.version !== PROFILE_CACHE_VERSION) return null
    if (Date.now() - cached.timestamp > PROFILE_CACHE_TTL) return null

    // Check memory cache again (another request might have populated it)
    const memCachedAgain = profilePhotoCache.get(cacheKey)
    if (memCachedAgain) return memCachedAgain

    // Create blob URL and store in memory cache
    const blob = new Blob([cached.data], { type: 'image/jpeg' })
    const url = URL.createObjectURL(blob)
    addToProfilePhotoCache(cacheKey, url)
    return url
  } catch {
    return null
  }
}

/**
 * Save profile photo to persistent cache (binary data)
 */
async function cacheProfilePhoto(peerId: number, size: string, buffer: Uint8Array): Promise<void> {
  try {
    const key = `${PROFILE_CACHE_PREFIX}${peerId}:${size}`
    const cached: CachedProfilePhoto = {
      data: buffer, // Store binary directly
      timestamp: Date.now(),
      version: PROFILE_CACHE_VERSION,
    }
    await set(key, cached)
  } catch {
    // Ignore cache errors
  }
}

// ============================================================================
// Download Queue Management
// ============================================================================

/**
 * Detect if running on mobile device
 * Used to reduce concurrent downloads for better performance
 */
const isMobile = typeof navigator !== 'undefined' && (
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
  ('maxTouchPoints' in navigator && navigator.maxTouchPoints > 0)
)

// Reduce concurrent downloads on mobile to save CPU/battery
const MAX_MEDIA_DOWNLOADS = isMobile ? 3 : 6
const MAX_PROFILE_DOWNLOADS = isMobile ? 2 : 4
const DOWNLOAD_TIMEOUT = isMobile ? 20000 : 15000 // Longer timeout on mobile (slower networks)

/**
 * Wrap a promise with a timeout
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout: ${label} took longer than ${ms}ms`))
    }, ms)

    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

/**
 * Creates a semaphore-based download queue
 * Prevents overwhelming the Telegram API with concurrent requests
 */
function createDownloadQueue(maxConcurrent: number) {
  let active = 0
  const queue: Array<() => void> = []

  return {
    acquire(): Promise<void> {
      if (active < maxConcurrent) {
        active++
        return Promise.resolve()
      }
      return new Promise(resolve => queue.push(resolve))
    },
    release(): void {
      const next = queue.shift()
      if (next) {
        next()
      } else {
        active--
      }
    },
    get pending() {
      return queue.length
    },
    get active() {
      return active
    }
  }
}

// Separate queues to prevent profile photos from blocking media
const mediaQueue = createDownloadQueue(MAX_MEDIA_DOWNLOADS)
const profileQueue = createDownloadQueue(MAX_PROFILE_DOWNLOADS)

// ============================================================================
// Debug Logging
// ============================================================================

function debugLog(message: string, ...args: unknown[]) {
  if (import.meta.env.DEV) {
    console.log(`[Media] ${message}`, ...args)
  }
}

function debugWarn(message: string, ...args: unknown[]) {
  if (import.meta.env.DEV) {
    console.warn(`[Media] ${message}`, ...args)
  }
}

// ============================================================================
// Download Media
// ============================================================================

/**
 * Download media from a message and return a blob URL
 *
 * Uses mtcute's built-in download methods which handle:
 * - Automatic file reference refresh on FILE_REFERENCE_EXPIRED
 * - Proper thumbnail extraction for videos/photos
 *
 * @param channelId - Channel ID
 * @param messageId - Message ID
 * @param thumbSize - Optional thumbnail size (small/medium/large)
 * @param signal - Optional AbortSignal for cancellation
 */
export async function downloadMedia(
  channelId: number,
  messageId: number,
  thumbSize?: 'small' | 'medium' | 'large',
  signal?: AbortSignal
): Promise<string | null> {
  const cacheKey = `${channelId}:${messageId}:${thumbSize ?? 'full'}`

  // Check memory cache first
  const cached = mediaCache.get(cacheKey)
  if (cached) {
    return cached
  }

  // For thumbnails, check IndexedDB persistent cache
  if (thumbSize) {
    const persistedUrl = await getCachedMediaThumbnail(channelId, messageId, thumbSize)
    if (persistedUrl) {
      return persistedUrl
    }
  }

  // Check if already aborted
  if (signal?.aborted) {
    return null
  }

  // Check if client is ready for API calls - throw to trigger retry
  if (!isClientReady()) {
    throw new Error('Client not ready')
  }

  const client = getTelegramClient()

  // Wait for available download slot
  await mediaQueue.acquire()

  // Check again after waiting for slot
  if (signal?.aborted) {
    mediaQueue.release()
    return null
  }

  try {
    // Always fetch fresh message to get valid file references
    const messages = await withTimeout(
      client.getMessages(channelId, [messageId]),
      DOWNLOAD_TIMEOUT,
      `getMessages(${channelId}, ${messageId})`
    )

    if (signal?.aborted) {
      return null
    }

    if (!Array.isArray(messages) || messages.length === 0 || !messages[0]) {
      debugWarn(`Message not found: channel=${channelId}, msg=${messageId}`, messages)
      return null
    }

    const msg = messages[0]

    if (!msg.media) {
      return null
    }

    const mediaType = msg.media.type

    // Only downloadable media types
    const downloadableTypes = ['photo', 'video', 'document', 'sticker', 'animation', 'audio', 'voice', 'webpage']
    if (!downloadableTypes.includes(mediaType)) {
      return null
    }

    // Download using mtcute's downloadAsBuffer
    let buffer: Uint8Array | null = null

    // Map thumb size to mtcute format
    // 's' = small (100x100), 'm' = medium (320x320), 'x' = large (800x800)
    const thumbType = thumbSize
      ? thumbSize === 'small' ? 's' : thumbSize === 'medium' ? 'm' : 'x'
      : undefined

    try {
      // For webpage, extract photo from preview
      let media: MediaWithThumbnails
      if (mediaType === 'webpage') {
        const photo = (msg.media as WebPageMedia).preview.photo
        if (!photo) return null
        media = photo
      } else {
        media = msg.media as MediaWithThumbnails
      }

      if (thumbType && 'getThumbnail' in media && typeof media.getThumbnail === 'function') {
        // For photos/videos/documents with thumbnails, get the thumbnail first
        const thumbnail = media.getThumbnail(thumbType)
          ?? media.getThumbnail('m')  // fallback to medium
          ?? media.getThumbnail('s')  // fallback to small
          ?? media.getThumbnail('x')  // fallback to large

        if (thumbnail) {
          buffer = await withTimeout(
            client.downloadAsBuffer(thumbnail),
            DOWNLOAD_TIMEOUT,
            `downloadThumbnail(${channelId}, ${messageId})`
          )
        } else {
          // No thumbnail found - download full media
          buffer = await withTimeout(
            client.downloadAsBuffer(media),
            DOWNLOAD_TIMEOUT,
            `downloadMedia(${channelId}, ${messageId})`
          )
        }
      } else {
        // Download full media (no getThumbnail method or no thumb requested)
        buffer = await withTimeout(
          client.downloadAsBuffer(media),
          DOWNLOAD_TIMEOUT,
          `downloadMedia(${channelId}, ${messageId})`
        )
      }
    } catch (downloadError) {
      if (signal?.aborted) {
        return null
      }

      // Check for FILE_REFERENCE_EXPIRED - try refetching message
      if (isFileReferenceExpired(downloadError)) {
        debugWarn(`File reference expired, refetching: channel=${channelId}, msg=${messageId}`)

        try {
          // Refetch message to get fresh file reference
          const freshMessages = await withTimeout(
            client.getMessages(channelId, [messageId]),
            DOWNLOAD_TIMEOUT,
            `retry-getMessages(${channelId}, ${messageId})`
          )

          if (signal?.aborted) {
            return null
          }

          if (freshMessages?.[0]?.media) {
            // Extract media (handle webpage separately)
            let freshMedia: MediaWithThumbnails
            if (freshMessages[0].media.type === 'webpage') {
              const photo = (freshMessages[0].media as WebPageMedia).preview.photo
              if (!photo) throw new Error('No photo in webpage')
              freshMedia = photo
            } else {
              freshMedia = freshMessages[0].media as MediaWithThumbnails
            }

            if (thumbType && 'getThumbnail' in freshMedia && typeof freshMedia.getThumbnail === 'function') {
              const thumbnail = freshMedia.getThumbnail(thumbType)
                ?? freshMedia.getThumbnail('m')
                ?? freshMedia.getThumbnail('s')
                ?? freshMedia.getThumbnail('x')

              if (thumbnail) {
                buffer = await withTimeout(client.downloadAsBuffer(thumbnail), DOWNLOAD_TIMEOUT, 'retry-thumb')
              } else {
                buffer = await withTimeout(client.downloadAsBuffer(freshMedia), DOWNLOAD_TIMEOUT, 'retry-media')
              }
            } else {
              buffer = await withTimeout(client.downloadAsBuffer(freshMedia), DOWNLOAD_TIMEOUT, 'retry-media')
            }
          }
        } catch (retryError) {
          debugWarn(`Retry failed: channel=${channelId}, msg=${messageId}`, retryError)
        }
      } else {
        debugWarn(`Download failed: channel=${channelId}, msg=${messageId}`, downloadError)
      }
    }

    if (signal?.aborted) {
      return null
    }

    if (!buffer || buffer.length === 0) {
      debugWarn(`Empty buffer: channel=${channelId}, msg=${messageId}`)
      return null
    }

    // Thumbnails are always JPEG images
    const mimeType = thumbSize ? 'image/jpeg' : getMimeType(msg.media)
    const uint8Buffer = new Uint8Array(buffer)

    // Create blob URL
    const blob = new Blob([uint8Buffer], { type: mimeType })
    const url = URL.createObjectURL(blob)

    // For thumbnails: persist binary to IndexedDB (async, don't await)
    if (thumbSize) {
      cacheMediaThumbnail(channelId, messageId, thumbSize, uint8Buffer, mimeType)
    }

    mediaCache.set(cacheKey, url)
    return url
  } catch (error) {
    if (!signal?.aborted) {
      // Silently ignore "channel is invalid" errors - user likely left the channel
      // or channel was deleted, but posts remain in cache
      if (isChannelInvalid(error)) {
        // Don't log - this is expected for cached posts from left channels
        return null
      }
      debugWarn(`Error downloading media: channel=${channelId}, msg=${messageId}`, error)
    }
    return null
  } finally {
    mediaQueue.release()
  }
}

// ============================================================================
// Download Profile Photo
// ============================================================================

/**
 * Download a channel/user profile photo
 *
 * Uses separate non-evicting memory cache to prevent blob URL revocation
 * while React Query still holds references. Also persists to IndexedDB.
 */
export async function downloadProfilePhoto(
  peerId: number,
  size: 'small' | 'big' = 'small'
): Promise<string | null> {
  const cacheKey = `profile:${peerId}:${size}`

  // Check in-memory cache first (non-evicting, blob URLs stay valid)
  const memCached = profilePhotoCache.get(cacheKey)
  if (memCached) {
    return memCached
  }

  // Check persistent cache (IndexedDB)
  // Note: getCachedProfilePhoto already stores in memory cache if found
  const persistedUrl = await getCachedProfilePhoto(peerId, size)
  if (persistedUrl) {
    return persistedUrl
  }

  // No cache - check if client is ready for API calls
  if (!isClientReady()) {
    throw new Error('Client not ready')
  }

  const client = getTelegramClient()

  // Use separate queue for profile photos
  await profileQueue.acquire()

  try {
    const peer = await resolvePeerWithPhoto(client, peerId)

    if (!peer?.photo) {
      return null
    }

    const photoLocation = size === 'big' ? peer.photo.big : peer.photo.small
    if (!photoLocation) {
      return null
    }

    const buffer = await withTimeout(
      client.downloadAsBuffer(photoLocation),
      DOWNLOAD_TIMEOUT,
      `profilePhoto(${peerId})`
    )

    if (!buffer || buffer.length === 0) {
      return null
    }

    // Convert to regular Uint8Array
    const uint8Buffer = new Uint8Array(buffer)

    // Save to persistent cache (async, don't await)
    cacheProfilePhoto(peerId, size, uint8Buffer)

    // Create blob URL
    const blob = new Blob([uint8Buffer], { type: 'image/jpeg' })
    const url = URL.createObjectURL(blob)

    // Store in memory cache with soft eviction
    addToProfilePhotoCache(cacheKey, url)
    return url
  } catch (error) {
    debugWarn(`Failed to download profile photo: peer=${peerId}`, error)
    return null
  } finally {
    profileQueue.release()
  }
}

/**
 * Determine peer type from ID based on Telegram's ID structure:
 * - Users: positive numbers
 * - Channels/Supergroups: negative with -100 prefix (e.g., -1001234567890)
 * - Regular groups: negative without -100 prefix
 */
function getPeerType(id: number): 'user' | 'channel' | 'chat' {
  if (id > 0) return 'user'
  if (id < -1000000000000) return 'channel'
  return 'chat'
}

/**
 * Resolve peer by ID to get profile photo
 * Uses ID structure to determine correct API method
 */
async function resolvePeerWithPhoto(
  client: ReturnType<typeof getTelegramClient>,
  peerId: number
) {
  const peerType = getPeerType(peerId)

  try {
    if (peerType === 'user') {
      const users = await withTimeout(
        client.getUsers([peerId]),
        DOWNLOAD_TIMEOUT,
        `getUsers(${peerId})`
      )
      return users?.[0] ?? null
    } else {
      // Channel or chat - use getChat
      return await withTimeout(
        client.getChat(peerId),
        DOWNLOAD_TIMEOUT,
        `getChat(${peerId})`
      )
    }
  } catch {
    return null
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Stream video media
 */
export async function getVideoStreamUrl(
  channelId: number,
  messageId: number
): Promise<string | null> {
  return downloadMedia(channelId, messageId)
}

/**
 * Preload media thumbnails for a batch of messages
 */
export async function preloadThumbnails(
  messages: Array<{ channelId: number; messageId: number }>
): Promise<void> {
  await Promise.allSettled(
    messages.map(({ channelId, messageId }) =>
      downloadMedia(channelId, messageId, 'large')
    )
  )
}

/**
 * Clear the media cache and revoke all blob URLs
 */
export function clearMediaCache(): void {
  mediaCache.clear()
  
  // Revoke profile photo blob URLs and clear cache
  for (const url of profilePhotoCache.values()) {
    URL.revokeObjectURL(url)
  }
  profilePhotoCache.clear()
  
  debugLog('Media cache cleared')
}

/**
 * Remove a specific media entry from cache
 * Useful for cleanup when component unmounts
 */
export function removeFromMediaCache(
  channelId: number,
  messageId: number,
  thumbSize?: 'small' | 'medium' | 'large'
): void {
  const cacheKey = `${channelId}:${messageId}:${thumbSize ?? 'full'}`
  mediaCache.delete(cacheKey)
}

/**
 * Get cached media URL if available
 */
export function getCachedMedia(
  channelId: number,
  messageId: number,
  thumbSize?: 'small' | 'medium' | 'large'
): string | null {
  const cacheKey = `${channelId}:${messageId}:${thumbSize ?? 'full'}`
  return mediaCache.get(cacheKey) ?? null
}

/**
 * Get current cache statistics
 */
export function getMediaCacheStats(): { size: number; maxSize: number } {
  return {
    size: mediaCache.size,
    maxSize: MEDIA_CACHE_MAX_SIZE,
  }
}

function getMimeType(media: { type: string; mimeType?: string }): string {
  if (media.mimeType) {
    return media.mimeType
  }

  switch (media.type) {
    case 'photo':
      return 'image/jpeg'
    case 'sticker':
      return 'image/webp'
    case 'video':
      return 'video/mp4'
    case 'animation':
      return 'video/mp4'
    default:
      return 'application/octet-stream'
  }
}

// ============================================================================
// IndexedDB Cache Cleanup
// ============================================================================

const CLEANUP_INTERVAL_MS = 1000 * 60 * 60 // 1 hour
let lastCleanupTime = 0

/**
 * Clean up expired entries from IndexedDB cache
 * Runs automatically, at most once per hour
 */
export async function cleanupExpiredCache(): Promise<{ deleted: number }> {
  const now = Date.now()

  // Throttle cleanup to run at most once per hour
  if (now - lastCleanupTime < CLEANUP_INTERVAL_MS) {
    return { deleted: 0 }
  }
  lastCleanupTime = now

  let deleted = 0

  try {
    const allKeys = await keys()

    for (const key of allKeys) {
      if (typeof key !== 'string') continue

      // Check media cache entries
      if (key.startsWith(MEDIA_CACHE_PREFIX)) {
        const cached = await get<CachedMedia>(key)
        if (cached && (now - cached.timestamp > MEDIA_CACHE_TTL || cached.version !== MEDIA_CACHE_VERSION)) {
          await del(key)
          deleted++
        }
      }

      // Check profile photo cache entries
      if (key.startsWith(PROFILE_CACHE_PREFIX)) {
        const cached = await get<CachedProfilePhoto>(key)
        if (cached && (now - cached.timestamp > PROFILE_CACHE_TTL || cached.version !== PROFILE_CACHE_VERSION)) {
          await del(key)
          deleted++
        }
      }
    }

    if (import.meta.env.DEV && deleted > 0) {
      console.log(`[Media] Cleaned up ${deleted} expired cache entries`)
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[Media] Cache cleanup failed:', error)
    }
  }

  return { deleted }
}

// Run cleanup on page load (after a delay to not block startup)
if (typeof window !== 'undefined') {
  setTimeout(cleanupExpiredCache, 10000)
}
