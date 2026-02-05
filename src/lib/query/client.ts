import { QueryClient } from '@tanstack/solid-query'
import { persistQueryClient, type PersistedClient, type Persister } from '@tanstack/query-persist-client-core'
import { get, set, del } from 'idb-keyval'
import { isMobile } from '@/config/constants'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache for 5 minutes before considering stale
      staleTime: 1000 * 60 * 5,
      // Keep in cache for 5-10 minutes - aggressively clean up to save memory
      gcTime: isMobile ? 1000 * 60 * 5 : 1000 * 60 * 10,
      // Retry failed requests - reduce on mobile to save bandwidth
      retry: isMobile ? 1 : 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      // Don't refetch on window focus - user controls refresh
      refetchOnWindowFocus: false,
      // Don't refetch on reconnect if data is fresh
      refetchOnReconnect: false,
    },
    mutations: {
      retry: 1,
    },
  },
})

// IndexedDB persister using idb-keyval with BigInt support
const IDB_KEY = 'telread-query-cache'

// Handle BigInt, Date, and Map serialization
const serialize = (data: unknown): string => {
  return JSON.stringify(data, (_, value) => {
    if (typeof value === 'bigint') {
      return { __bigint: value.toString() }
    }
    if (value instanceof Date) {
      return { __date: value.toISOString() }
    }
    if (value instanceof Map) {
      return { __map: Array.from(value.entries()) }
    }
    return value
  })
}

const deserialize = (str: string): unknown => {
  return JSON.parse(str, (_, value) => {
    if (value && typeof value === 'object') {
      if ('__bigint' in value) return BigInt(value.__bigint)
      if ('__date' in value) return new Date(value.__date)
      if ('__map' in value) return new Map(value.__map)
    }
    return value
  })
}

const idbPersister: Persister = {
  persistClient: async (client: PersistedClient) => {
    try {
      await set(IDB_KEY, serialize(client))
    } catch (error: unknown) {
      // Handle IndexedDB quota exceeded - clear and retry once
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        if (import.meta.env.DEV) {
          console.warn('[QueryClient] IndexedDB quota exceeded, clearing old cache and retrying')
        }
        try {
          await del(IDB_KEY)
          await set(IDB_KEY, serialize(client))
        } catch {
          // Give up silently - app will work without persistence
        }
        return
      }
      throw error
    }
  },
  restoreClient: async (): Promise<PersistedClient | undefined> => {
    const data = await get<string>(IDB_KEY)
    return data ? (deserialize(data) as PersistedClient) : undefined
  },
  removeClient: async () => {
    await del(IDB_KEY)
  },
}

// Clear old cache on version change
const CACHE_VERSION = 'v11' // v11: persist synced posts for page reload survival
const CACHE_VERSION_KEY = 'telread-cache-version'

const storedVersion = localStorage.getItem(CACHE_VERSION_KEY)
if (storedVersion !== CACHE_VERSION) {
  // Clear IndexedDB cache
  del(IDB_KEY).then(() => {
    if (import.meta.env.DEV) {
      console.log('[QueryClient] Cache cleared due to version change:', storedVersion, '->', CACHE_VERSION)
    }
  })
  localStorage.setItem(CACHE_VERSION_KEY, CACHE_VERSION)
}

// Enable persistence - cache survives page reloads
// Exclude media queries (blob URLs can't be persisted)
// Returns [unsubscribe, restorePromise]
const [, restorePromise] = persistQueryClient({
  queryClient,
  persister: idbPersister,
  maxAge: 1000 * 60 * 60 * 1, // 1 hour - keep persistence short to save memory
  buster: CACHE_VERSION,
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => {
      const key = query.queryKey as string[]
      // Don't persist media queries - they use blob URLs (session-only)
      if (key[0] === 'media') return false
      // Don't persist resolve queries with null data (failed lookups)
      if (key[0] === 'channels' && key[1] === 'resolve' && !query.state.data) return false
      return query.state.status === 'success'
    },
  },
})

// Export promise for app to wait on before rendering
export const cacheReadyPromise = restorePromise.then(() => {
  if (import.meta.env.DEV) {
    const cache = queryClient.getQueryCache().getAll()
    console.log(`[QueryClient] Cache ready: ${cache.length} queries`)
    cache.forEach(q => {
      const hasData = q.state.data !== undefined
      console.log(`  - ${JSON.stringify(q.queryKey)}: ${hasData ? 'has data' : 'no data'}`)
    })
  }
})
