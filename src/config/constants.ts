/**
 * Application-wide constants
 *
 * Centralized configuration for limits and thresholds
 */

// ============================================================================
// Timing Constants (in milliseconds)
// ============================================================================

export const TIMING = {
  /** Delay before fading out splash screen */
  SPLASH_FADE_DELAY: 150,
  /** Service worker update check interval (1 hour) */
  SW_UPDATE_INTERVAL: 60 * 60 * 1000,
  /** Activity tracking update interval (5 minutes) */
  ACTIVITY_UPDATE_INTERVAL: 5 * 60 * 1000,
  /** Query stale time for folders/channels (5 minutes) */
  QUERY_STALE_TIME: 5 * 60 * 1000,
  /** Query garbage collection time (10 minutes) */
  QUERY_GC_TIME: 10 * 60 * 1000,
  /** Delay before restoring scroll position */
  SCROLL_RESTORE_DELAY: 50,
  /** Page transition duration */
  PAGE_TRANSITION_DELAY: 150,
}

// ============================================================================
// UI Configuration
// ============================================================================

export const UI = {
  /** Initial number of posts to render in timeline */
  INITIAL_RENDER_COUNT: 15,
  /** Number of posts to add when scrolling */
  RENDER_BATCH_SIZE: 10,
  /** Character count threshold for text truncation */
  TRUNCATE_THRESHOLD: 280,
  /** Root margin for intersection observer */
  OBSERVER_ROOT_MARGIN: '100px',
}

// ============================================================================
// Media Configuration
// ============================================================================

export const MEDIA = {
  /** Default image width when not specified */
  DEFAULT_WIDTH: 1200,
  /** Default image height when not specified */
  DEFAULT_HEIGHT: 800,
  /** Size for color extraction sampling */
  COLOR_EXTRACT_SIZE: 50,
  /** Minimum brightness threshold for color extraction */
  BRIGHTNESS_MIN: 30,
  /** Maximum brightness threshold for color extraction */
  BRIGHTNESS_MAX: 225,
}

// ============================================================================
// API Limits
// ============================================================================

/**
 * Maximum dialogs to iterate when fetching channels
 * High limit to ensure all subscribed channels are loaded
 * Most users have < 500 dialogs, real-time updates handle the rest
 */
export const MAX_DIALOGS_TO_ITERATE = 1000

/**
 * Maximum concurrent media downloads
 * Higher value = faster loading but more API pressure
 */
export const MAX_CONCURRENT_DOWNLOADS = 10

/**
 * Download timeout in milliseconds (30 seconds)
 * Prevents stuck downloads from blocking the queue
 */
export const DOWNLOAD_TIMEOUT_MS = 30000

/**
 * Maximum comment length (Telegram limit)
 */
export const MAX_COMMENT_LENGTH = 4096

// ============================================================================
// Cache Configuration
// ============================================================================

/**
 * Maximum items in media LRU cache
 * Each item holds a blob URL reference
 * Note: We don't revoke URLs on eviction (components may still reference them)
 * so browser GC handles cleanup. IndexedDB provides persistence.
 */
export const MEDIA_CACHE_MAX_SIZE = 100

/**
 * Query cache stale time in milliseconds (30 minutes)
 */
export const QUERY_STALE_TIME = 1000 * 60 * 30

/**
 * Query cache garbage collection time in milliseconds (24 hours)
 */
export const QUERY_GC_TIME = 1000 * 60 * 60 * 24

// ============================================================================
// UI Configuration
// ============================================================================

/**
 * Scroll threshold for triggering infinite scroll (pixels from bottom)
 */
export const INFINITE_SCROLL_THRESHOLD = 500

/**
 * Throttle delay for scroll events in milliseconds
 */
export const SCROLL_THROTTLE_MS = 300

/**
 * Default aspect ratio for media without dimensions
 */
export const DEFAULT_ASPECT_RATIO = 16 / 9
