import type { Message } from '@/lib/telegram'

/**
 * A timeline item can be either a single post or a media group (album)
 */
export type TimelineItem =
  | { type: 'single'; post: Message }
  | { type: 'group'; posts: Message[]; groupedId: bigint }

/**
 * Group consecutive posts by groupedId into albums
 *
 * Posts with the same groupedId are combined into a single timeline item.
 * The first post in the group provides the text/metadata, others provide media.
 *
 * Two-pass O(n) implementation:
 * 1. Collect groups by groupedId
 * 2. Build result array preserving order
 */
export function groupPostsByMediaGroup(posts: Message[]): TimelineItem[] {
  // First pass: collect groups
  const groupMap = new Map<string, Message[]>()
  const orderKeys: Array<{ type: 'single'; post: Message } | { type: 'group'; key: string }> = []
  const seenGroups = new Set<string>()

  for (const post of posts) {
    if (!post.groupedId) {
      // Single post - add directly to order
      orderKeys.push({ type: 'single', post })
      continue
    }

    const groupKey = post.groupedId.toString()
    
    // Add to group
    const existing = groupMap.get(groupKey)
    if (existing) {
      existing.push(post)
    } else {
      groupMap.set(groupKey, [post])
    }

    // Track first occurrence in order
    if (!seenGroups.has(groupKey)) {
      seenGroups.add(groupKey)
      orderKeys.push({ type: 'group', key: groupKey })
    }
  }

  // Second pass: build result
  const result: TimelineItem[] = []
  
  for (const item of orderKeys) {
    if (item.type === 'single') {
      result.push({ type: 'single', post: item.post })
    } else {
      const groupPosts = groupMap.get(item.key)
      if (!groupPosts || groupPosts.length === 0) continue

      // Sort by message ID to maintain order within album
      groupPosts.sort((a, b) => a.id - b.id)

      const firstPost = groupPosts[0]
      if (groupPosts.length === 1) {
        result.push({ type: 'single', post: firstPost })
      } else if (firstPost.groupedId) {
        result.push({
          type: 'group',
          posts: groupPosts,
          groupedId: firstPost.groupedId,
        })
      }
    }
  }

  return result
}

