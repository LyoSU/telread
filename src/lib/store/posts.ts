/**
 * Centralized posts store - Telegram Web style
 *
 * Simple architecture:
 * - Single source of truth for all posts
 * - New real-time posts go to pendingKeys (Twitter-style "N new posts")
 * - User clicks to reveal pending posts
 * - Batching only for high-frequency updates (views, reactions)
 */
import { createStore, produce } from 'solid-js/store'
import type { Message } from '@/lib/telegram'
import { getTime } from '@/lib/utils'
import { isMobile } from '@/config/constants'

/**
 * Maximum posts to keep in memory
 * Desktop: ~300 posts * ~2KB = ~600KB
 * Mobile: ~150 posts * ~2KB = ~300KB (less GC pressure)
 */
const MAX_POSTS = isMobile ? 150 : 300

/**
 * Maximum pending posts before auto-reveal
 * Prevents unbounded growth if user never clicks "new posts"
 */
const MAX_PENDING = isMobile ? 50 : 100

type PostKey = string

function makeKey(channelId: number, messageId: number): PostKey {
  return `${channelId}:${messageId}`
}

interface PostsState {
  byId: Record<PostKey, Message>
  sortedKeys: PostKey[]
  /** New posts waiting to be revealed (Twitter-style "N new posts" button) */
  pendingKeys: PostKey[]
  isInitialized: boolean
}

const [state, setState] = createStore<PostsState>({
  byId: {},
  sortedKeys: [],
  pendingKeys: [],
  isInitialized: false,
})

/**
 * Binary search insertion for sorted keys (newest first)
 */
function insertSorted(keys: PostKey[], key: PostKey, byId: Record<PostKey, Message>): PostKey[] {
  const post = byId[key]
  if (!post) return keys
  
  const postTime = getTime(post.date)
  let low = 0
  let high = keys.length

  while (low < high) {
    const mid = (low + high) >>> 1
    const midPost = byId[keys[mid]]
    if (midPost && getTime(midPost.date) > postTime) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  const result = [...keys]
  result.splice(low, 0, key)
  return result
}

/**
 * Trim to MAX_POSTS without cutting media groups
 * May slightly exceed MAX_POSTS to keep groups intact (up to +9 for albums)
 */
function trimToMaxPosts(s: PostsState): void {
  if (s.sortedKeys.length <= MAX_POSTS) return
  
  let cutIndex = MAX_POSTS
  const postAtBoundary = s.byId[s.sortedKeys[MAX_POSTS - 1]]
  
  // If post at boundary is part of a group, extend to include full group
  if (postAtBoundary?.groupedId) {
    const groupId = postAtBoundary.groupedId.toString()
    while (cutIndex < s.sortedKeys.length) {
      const post = s.byId[s.sortedKeys[cutIndex]]
      if (!post?.groupedId || post.groupedId.toString() !== groupId) break
      cutIndex++
    }
  }
  
  const keysToRemove = s.sortedKeys.slice(cutIndex)
  s.sortedKeys = s.sortedKeys.slice(0, cutIndex)
  
  for (const key of keysToRemove) {
    delete s.byId[key]
  }
}

/**
 * Add or update a single post
 * 
 * For real-time updates:
 * - If post is NEWER than the top visible post → add to pendingKeys (show "N new posts" button)
 * - If post is OLDER → add directly to sortedKeys (no button, just insert in correct position)
 * 
 * This prevents showing "N new posts" for old posts (scheduled, forwards with old dates)
 * that would just appear somewhere in the middle of the feed anyway.
 */
export function upsertPost(post: Message): void {
  const key = makeKey(post.channelId, post.id)
  
  setState(produce((s) => {
    const existing = s.byId[key]
    
    if (existing) {
      // Update only if newer (O(1) check via byId)
      const existingTime = getTime(existing.editDate ?? existing.date)
      const newTime = getTime(post.editDate ?? post.date)
      if (newTime <= existingTime) return
      s.byId[key] = post
    } else {
      // New post - check if it's actually newer than the top visible post
      s.byId[key] = post
      const postTime = getTime(post.date)
      
      // Get the time of the top visible post (first in sortedKeys)
      const topKey = s.sortedKeys[0]
      const topPost = topKey ? s.byId[topKey] : null
      const topTime = topPost ? getTime(topPost.date) : 0
      
      if (postTime > topTime) {
        // Post is newer than top → add to pending (show "N new posts" button)
        s.pendingKeys = insertSorted(s.pendingKeys, key, s.byId)
        
        // Auto-reveal if too many pending (prevents unbounded growth)
        if (s.pendingKeys.length > MAX_PENDING) {
          // Move oldest pending posts to sorted
          const overflow = s.pendingKeys.slice(MAX_PENDING)
          s.pendingKeys = s.pendingKeys.slice(0, MAX_PENDING)
          for (const k of overflow) {
            s.sortedKeys = insertSorted(s.sortedKeys, k, s.byId)
          }
          trimToMaxPosts(s)
        }
      } else {
        // Post is older than top → add directly to sorted (no button)
        s.sortedKeys = insertSorted(s.sortedKeys, key, s.byId)
        trimToMaxPosts(s)
        // Note: Not logging individual old posts to reduce noise during catch-up
      }
    }
  }))
}

/**
 * Add or update multiple posts - batch operation
 */
export function upsertPosts(posts: Message[]): void {
  if (posts.length === 0) return

  setState(produce((s) => {
    const newKeys: PostKey[] = []
    const existingCount = Object.keys(s.byId).length

    for (const post of posts) {
      const key = makeKey(post.channelId, post.id)
      const existing = s.byId[key]

      if (existing) {
        const existingTime = getTime(existing.editDate ?? existing.date)
        const newTime = getTime(post.editDate ?? post.date)
        if (newTime <= existingTime) continue
      } else {
        newKeys.push(key)
      }
      
      s.byId[key] = post
    }

    // Batch insert new keys
    if (import.meta.env.DEV && newKeys.length > 0) {
      console.log(`[Posts] upsertPosts: ${posts.length} input, ${newKeys.length} new, ${existingCount} existing -> ${existingCount + newKeys.length} total`)
    }
    if (newKeys.length > 0) {
      // Sort new keys by date
      newKeys.sort((a, b) => {
        const postA = s.byId[a]
        const postB = s.byId[b]
        if (!postA || !postB) return 0
        return getTime(postB.date) - getTime(postA.date)
      })
      
      // Merge with existing (both sorted, merge sort style)
      const merged: PostKey[] = []
      let i = 0, j = 0
      
      while (i < s.sortedKeys.length && j < newKeys.length) {
        const existingPost = s.byId[s.sortedKeys[i]]
        const newPost = s.byId[newKeys[j]]
        
        if (!existingPost) { i++; continue }
        if (!newPost) { j++; continue }
        
        if (getTime(existingPost.date) >= getTime(newPost.date)) {
          merged.push(s.sortedKeys[i++])
        } else {
          merged.push(newKeys[j++])
        }
      }
      
      while (i < s.sortedKeys.length) merged.push(s.sortedKeys[i++])
      while (j < newKeys.length) merged.push(newKeys[j++])
      
      s.sortedKeys = merged
      trimToMaxPosts(s)
    }
  }))
}

/**
 * Remove posts
 */
export function removePosts(channelId: number, messageIds: number[]): void {
  const keysToRemove = new Set(messageIds.map((id) => makeKey(channelId, id)))

  setState(produce((s) => {
    for (const key of keysToRemove) {
      delete s.byId[key]
    }
    s.sortedKeys = s.sortedKeys.filter((k) => !keysToRemove.has(k))
    s.pendingKeys = s.pendingKeys.filter((k) => !keysToRemove.has(k))
  }))
}

/**
 * Reveal pending posts - move them to visible timeline
 * Called when user clicks "N new posts" button
 * 
 * IMPORTANT: This must be a single atomic setState to avoid race conditions
 * 
 * Since upsertPost only adds posts to pendingKeys if they're newer than the top,
 * all pending posts are guaranteed to be newer than all sorted posts.
 * So we can simply prepend them (no merge sort needed).
 */
export function revealPendingPosts(): void {
  // Early exit check (read outside produce is OK for this)
  if (state.pendingKeys.length === 0) {
    if (import.meta.env.DEV) {
      console.log('[Posts] No pending posts to reveal')
    }
    return
  }

  if (import.meta.env.DEV) {
    console.log(`[Posts] revealPendingPosts: ${state.pendingKeys.length} pending, ${state.sortedKeys.length} sorted`)
  }

  // Single atomic update to avoid race conditions
  setState(produce((s) => {
    if (s.pendingKeys.length === 0) return // Double-check inside produce
    
    const pendingCount = s.pendingKeys.length
    
    // Pending posts are guaranteed to be newer than sorted (enforced in upsertPost)
    // Just prepend them to maintain sorted order (newest first)
    s.sortedKeys = [...s.pendingKeys, ...s.sortedKeys]
    s.pendingKeys = []
    
    if (import.meta.env.DEV) {
      console.log(`[Posts] Revealed ${pendingCount} posts, total: ${s.sortedKeys.length}`)
    }
    
    // Trim from bottom (oldest posts)
    trimToMaxPosts(s)
  }))
}

// ============================================================================
// Batched updates for high-frequency changes (views, reactions)
// ============================================================================

const pendingViewsUpdates = new Map<PostKey, number>()
let viewsTimer: ReturnType<typeof setTimeout> | null = null

function flushViews(): void {
  if (pendingViewsUpdates.size === 0) return
  const updates = new Map(pendingViewsUpdates)
  pendingViewsUpdates.clear()
  viewsTimer = null

  for (const [key, views] of updates) {
    if (state.byId[key]) {
      setState('byId', key, 'views', views)
    }
  }
}

export function updatePostViews(channelId: number, messageId: number, views: number): void {
  const key = makeKey(channelId, messageId)
  if (!state.byId[key]) return
  
  pendingViewsUpdates.set(key, views)
  if (!viewsTimer) {
    viewsTimer = setTimeout(flushViews, 2000) // 2s batch window
  }
}

const pendingReactionsUpdates = new Map<PostKey, Message['reactions']>()
let reactionsTimer: ReturnType<typeof setTimeout> | null = null

function flushReactions(): void {
  if (pendingReactionsUpdates.size === 0) return
  const updates = new Map(pendingReactionsUpdates)
  pendingReactionsUpdates.clear()
  reactionsTimer = null

  for (const [key, reactions] of updates) {
    if (state.byId[key]) {
      setState('byId', key, 'reactions', reactions ?? [])
    }
  }
}

/**
 * Update reactions with debounce (for incoming updates from server)
 */
export function updatePostReactions(
  channelId: number,
  messageId: number,
  reactions: Message['reactions']
): void {
  const key = makeKey(channelId, messageId)
  if (!state.byId[key]) return
  
  pendingReactionsUpdates.set(key, reactions)
  if (!reactionsTimer) {
    reactionsTimer = setTimeout(flushReactions, 2000) // 2s batch window
  }
}

/**
 * Update reactions immediately (for optimistic updates)
 */
export function updatePostReactionsImmediate(
  channelId: number,
  messageId: number,
  reactions: Message['reactions']
): void {
  const key = makeKey(channelId, messageId)
  if (!state.byId[key]) return
  
  // Clear any pending update for this post
  pendingReactionsUpdates.delete(key)
  
  // Update immediately
  setState('byId', key, 'reactions', reactions ?? [])
}

// ============================================================================
// Accessors
// ============================================================================

export function getPost(channelId: number, messageId: number): Message | undefined {
  return state.byId[makeKey(channelId, messageId)]
}

export function isStoreReady(): boolean {
  return state.isInitialized
}

export function markStoreInitialized(): void {
  if (!state.isInitialized) {
    setState('isInitialized', true)
  }
}

export const postsState = state

// ============================================================================
// Cleanup
// ============================================================================

export function clearPosts(): void {
  if (viewsTimer) { clearTimeout(viewsTimer); viewsTimer = null }
  if (reactionsTimer) { clearTimeout(reactionsTimer); reactionsTimer = null }
  pendingViewsUpdates.clear()
  pendingReactionsUpdates.clear()

  setState({
    byId: {},
    sortedKeys: [],
    pendingKeys: [],
    isInitialized: false,
  })
}
