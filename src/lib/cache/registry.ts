/**
 * Centralized Cache Registry
 * 
 * Single source of truth for all cache keys and databases.
 * Provides unified clear/stats functions.
 */
import { del, keys, get } from 'idb-keyval'

// ============================================================================
// Cache Keys Registry
// ============================================================================

/** IndexedDB keys used by idb-keyval */
export const CACHE_KEYS = {
  // React Query persistence
  QUERY_CACHE: 'telread-query-cache',
  
  // Media caches (prefixes)
  MEDIA_THUMB_PREFIX: 'media-thumb:',
  PROFILE_PHOTO_PREFIX: 'profile-photo:',
  
  // Other stores
  THEME: 'telread-theme',
  PREFERENCES: 'telread-preferences',
  BOOKMARKS: 'telread-bookmarks',
} as const

/** localStorage keys */
export const LOCAL_STORAGE_KEYS = {
  CACHE_VERSION: 'telread-cache-version',
  FOLDERS: 'telread-folders',
  ACTIVITY: 'telread-activity',
  AUTH_HINT: 'telread-auth-hint',
  SCROLL_POSITION: 'telread-timeline-scroll',
} as const

// ============================================================================
// Clear Functions
// ============================================================================

/**
 * Clear all IndexedDB caches (query cache + media caches)
 * Returns count of deleted entries
 */
export async function clearAllIndexedDBCaches(): Promise<{ deleted: number }> {
  let deleted = 0

  try {
    const allKeys = await keys()

    // Collect keys to delete
    const keysToDelete: IDBValidKey[] = []

    for (const key of allKeys) {
      if (typeof key !== 'string') continue

      // Query cache
      if (key === CACHE_KEYS.QUERY_CACHE) {
        keysToDelete.push(key)
        continue
      }

      // Media thumbnails
      if (key.startsWith(CACHE_KEYS.MEDIA_THUMB_PREFIX)) {
        keysToDelete.push(key)
        continue
      }

      // Profile photos
      if (key.startsWith(CACHE_KEYS.PROFILE_PHOTO_PREFIX)) {
        keysToDelete.push(key)
        continue
      }
    }

    // Delete in parallel batches for performance
    const BATCH_SIZE = 50
    for (let i = 0; i < keysToDelete.length; i += BATCH_SIZE) {
      const batch = keysToDelete.slice(i, i + BATCH_SIZE)
      await Promise.all(batch.map(key => del(key)))
      deleted += batch.length
    }

    if (import.meta.env.DEV) {
      console.log(`[CacheRegistry] Cleared ${deleted} IndexedDB entries`)
    }
  } catch (error) {
    console.error('[CacheRegistry] Failed to clear IndexedDB caches:', error)
  }

  return { deleted }
}

/**
 * Clear only media caches (thumbnails + profile photos)
 */
export async function clearMediaCaches(): Promise<{ deleted: number }> {
  let deleted = 0

  try {
    const allKeys = await keys()
    const keysToDelete: IDBValidKey[] = []

    for (const key of allKeys) {
      if (typeof key !== 'string') continue

      if (
        key.startsWith(CACHE_KEYS.MEDIA_THUMB_PREFIX) ||
        key.startsWith(CACHE_KEYS.PROFILE_PHOTO_PREFIX)
      ) {
        keysToDelete.push(key)
      }
    }

    // Delete in parallel batches
    const BATCH_SIZE = 50
    for (let i = 0; i < keysToDelete.length; i += BATCH_SIZE) {
      const batch = keysToDelete.slice(i, i + BATCH_SIZE)
      await Promise.all(batch.map(key => del(key)))
      deleted += batch.length
    }

    if (import.meta.env.DEV) {
      console.log(`[CacheRegistry] Cleared ${deleted} media cache entries`)
    }
  } catch (error) {
    console.error('[CacheRegistry] Failed to clear media caches:', error)
  }

  return { deleted }
}

/**
 * Clear query cache only
 */
export async function clearQueryCache(): Promise<void> {
  try {
    await del(CACHE_KEYS.QUERY_CACHE)
    if (import.meta.env.DEV) {
      console.log('[CacheRegistry] Cleared query cache')
    }
  } catch (error) {
    console.error('[CacheRegistry] Failed to clear query cache:', error)
  }
}

/**
 * Clear all localStorage entries used by the app
 */
export function clearAllLocalStorage(): void {
  try {
    for (const key of Object.values(LOCAL_STORAGE_KEYS)) {
      localStorage.removeItem(key)
    }
    if (import.meta.env.DEV) {
      console.log('[CacheRegistry] Cleared localStorage')
    }
  } catch (error) {
    console.error('[CacheRegistry] Failed to clear localStorage:', error)
  }
}

// ============================================================================
// Stats Functions
// ============================================================================

interface CacheStats {
  queryCache: boolean
  mediaThumbnails: number
  profilePhotos: number
  totalEntries: number
  estimatedSizeKB: number
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<CacheStats> {
  const stats: CacheStats = {
    queryCache: false,
    mediaThumbnails: 0,
    profilePhotos: 0,
    totalEntries: 0,
    estimatedSizeKB: 0,
  }

  try {
    const allKeys = await keys()

    for (const key of allKeys) {
      if (typeof key !== 'string') continue

      if (key === CACHE_KEYS.QUERY_CACHE) {
        stats.queryCache = true
        stats.totalEntries++
        // Estimate query cache size
        const data = await get(key)
        if (data) {
          const size = typeof data === 'string' ? data.length : JSON.stringify(data).length
          stats.estimatedSizeKB += size / 1024
        }
        continue
      }

      if (key.startsWith(CACHE_KEYS.MEDIA_THUMB_PREFIX)) {
        stats.mediaThumbnails++
        stats.totalEntries++
        continue
      }

      if (key.startsWith(CACHE_KEYS.PROFILE_PHOTO_PREFIX)) {
        stats.profilePhotos++
        stats.totalEntries++
        continue
      }
    }

    // Rough estimate: ~50KB average per media entry
    stats.estimatedSizeKB += (stats.mediaThumbnails + stats.profilePhotos) * 50
  } catch (error) {
    console.error('[CacheRegistry] Failed to get cache stats:', error)
  }

  return stats
}
