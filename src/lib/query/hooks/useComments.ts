import {
  createQuery,
  createMutation,
  useQueryClient,
} from '@tanstack/solid-query'
import { createEffect, on, onCleanup } from 'solid-js'
import {
  fetchComments,
  sendComment,
  downloadProfilePhoto,
  subscribeToComments,
  onCommentUpdate,
  CommentError,
  type Comment,
  type CommentThread,
  type CommentUpdate,
  type CommentSubscription,
} from '@/lib/telegram'
import { isFloodWait } from '@/lib/telegram/errors'
import { authStore } from '@/lib/store'
import { queryKeys } from '../keys'

/**
 * Maximum number of author avatars to prefetch
 * Only prefetch visible/top-level comment authors to reduce API calls
 */
const MAX_AVATAR_PREFETCH = 10

/**
 * Collect unique author IDs from top-level comments (limited)
 * Only prefetches visible authors to reduce unnecessary API calls
 */
function collectVisibleAuthorIds(comments: Comment[], limit: number = MAX_AVATAR_PREFETCH): number[] {
  const ids = new Set<number>()

  // Only collect from top-level comments (visible initially)
  for (const comment of comments) {
    if (ids.size >= limit) break

    if (comment.author.id > 0) {
      ids.add(comment.author.id)
    }
  }

  return Array.from(ids)
}

/**
 * Hook to fetch comments for a post
 *
 * Provides error handling with specific error codes:
 * - DISABLED: Comments are disabled for this post
 * - NOT_FOUND: Post not found
 * - NETWORK: Network/rate limit error
 * - VALIDATION: Invalid input
 * - UNKNOWN: Unknown error
 */
export function useComments(
  channelId: () => number,
  messageId: () => number,
  enabled?: () => boolean
) {
  const queryClient = useQueryClient()

  const query = createQuery(() => ({
    queryKey: queryKeys.comments.thread(channelId(), messageId()),
    queryFn: () => fetchComments(channelId(), messageId()),
    staleTime: 1000 * 60 * 2, // 2 minutes - comments change more frequently
    enabled: enabled?.() ?? true,
    retry: (failureCount, error) => {
      // Don't retry on validation or disabled errors
      if (error instanceof CommentError) {
        if (error.code === 'VALIDATION' || error.code === 'DISABLED') {
          return false
        }
      }
      return failureCount < 2
    },
  }))

  // Prefetch author avatars when comments load (limited to visible)
  createEffect(
    on(
      () => query.data,
      (data) => {
        if (!data?.comments.length) return

        // Only prefetch top-level visible authors to reduce API calls
        const authorIds = collectVisibleAuthorIds(data.comments)

        for (const authorId of authorIds) {
          queryClient.prefetchQuery({
            queryKey: queryKeys.media.profile(authorId),
            queryFn: () => downloadProfilePhoto(authorId, 'small'),
            staleTime: 1000 * 60 * 60 * 24, // 24 hours
            retry: (failureCount, error) => {
              if (isFloodWait(error)) return failureCount < 2 && error.seconds < 60
              return failureCount < 2
            },
            retryDelay: (failureCount, error) => {
              if (isFloodWait(error)) return (error.seconds + 1) * 1000
              return Math.min(1000 * 2 ** failureCount, 30000)
            },
          })
        }
      }
    )
  )

  // Subscribe to real-time updates when discussion chat is available
  createEffect(
    on(
      () => query.data,
      (data) => {
        if (!data?.discussionChatId) return

        const subscription: CommentSubscription = {
          channelId: channelId(),
          messageId: messageId(),
          discussionChatId: data.discussionChatId,
          discussionMessageId: data.discussionMessageId,
        }

        // Subscribe to updates for this discussion
        const unsubscribe = subscribeToComments(subscription)

        // Cleanup on unmount or when discussion changes
        onCleanup(unsubscribe)
      }
    )
  )

  // Handle incoming comment updates
  createEffect(() => {
    const cId = channelId()
    const mId = messageId()

    const unsubscribe = onCommentUpdate((sub, update) => {
      // Only process updates for this specific thread
      if (sub.channelId !== cId || sub.messageId !== mId) return

      applyCommentUpdate(queryClient, cId, mId, update)
    })

    onCleanup(unsubscribe)
  })

  return query
}

/**
 * Apply a comment update to the query cache
 */
function applyCommentUpdate(
  queryClient: ReturnType<typeof useQueryClient>,
  channelId: number,
  messageId: number,
  update: CommentUpdate
): void {
  const queryKey = queryKeys.comments.thread(channelId, messageId)

  switch (update.type) {
    case 'new': {
      queryClient.setQueryData<CommentThread>(queryKey, (old) => {
        if (!old) return old

        // Check if comment already exists (dedup)
        const exists = findCommentById(old.comments, update.comment.id)
        if (exists) return old

        // Resolve replyToAuthor if this is a reply
        const comment = { ...update.comment }
        if (comment.replyToId) {
          const parent = findCommentById(old.comments, comment.replyToId)
          if (parent) {
            comment.replyToAuthor = { name: parent.author.name }
          }
        }

        // Add as reply or root comment
        if (comment.replyToId) {
          return {
            ...old,
            totalCount: old.totalCount + 1,
            comments: addReplyToTree(old.comments, comment.replyToId, comment),
          }
        }

        // Add to beginning of root comments (newest first)
        return {
          ...old,
          totalCount: old.totalCount + 1,
          comments: [comment, ...old.comments],
        }
      })
      break
    }

    case 'edit': {
      queryClient.setQueryData<CommentThread>(queryKey, (old) => {
        if (!old) return old
        return {
          ...old,
          comments: updateCommentInTree(old.comments, update.comment),
        }
      })
      break
    }

    case 'delete': {
      queryClient.setQueryData<CommentThread>(queryKey, (old) => {
        if (!old) return old
        const deleted = update.commentIds.length
        return {
          ...old,
          totalCount: Math.max(0, old.totalCount - deleted),
          comments: removeCommentsFromTree(old.comments, update.commentIds),
        }
      })
      break
    }
  }
}

/**
 * Find a comment by ID in the tree (recursive)
 */
function findCommentById(comments: Comment[], id: number): Comment | undefined {
  for (const comment of comments) {
    if (comment.id === id) return comment
    if (comment.replies?.length) {
      const found = findCommentById(comment.replies, id)
      if (found) return found
    }
  }
  return undefined
}

/**
 * Update a comment in the tree (recursive clone)
 */
function updateCommentInTree(comments: Comment[], updated: Comment): Comment[] {
  return comments.map((comment) => {
    if (comment.id === updated.id) {
      // Preserve replies and replyToAuthor from existing comment
      return {
        ...updated,
        replies: comment.replies,
        replyToAuthor: comment.replyToAuthor,
      }
    }
    if (comment.replies?.length) {
      return {
        ...comment,
        replies: updateCommentInTree(comment.replies, updated),
      }
    }
    return comment
  })
}

/**
 * Remove comments from tree by IDs (recursive clone)
 */
function removeCommentsFromTree(comments: Comment[], ids: number[]): Comment[] {
  const idSet = new Set(ids)
  return comments
    .filter((comment) => !idSet.has(comment.id))
    .map((comment) => {
      if (comment.replies?.length) {
        return {
          ...comment,
          replies: removeCommentsFromTree(comment.replies, ids),
        }
      }
      return comment
    })
}

/**
 * Hook to send a comment with optimistic updates
 *
 * Handles validation errors before sending and provides
 * proper rollback on failure.
 */
export function useSendComment(channelId: () => number, messageId: () => number) {
  const queryClient = useQueryClient()

  return createMutation(() => ({
    mutationFn: ({
      text,
      replyToCommentId,
    }: {
      text: string
      replyToCommentId?: number
    }) => sendComment(channelId(), messageId(), text, replyToCommentId),

    // Optimistic update
    onMutate: async ({ text, replyToCommentId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: queryKeys.comments.thread(channelId(), messageId()),
      })

      // Snapshot previous value
      const previous = queryClient.getQueryData<CommentThread>(
        queryKeys.comments.thread(channelId(), messageId())
      )

      // Optimistically add the new comment with actual user data
      const optimisticComment: Comment = {
        id: Date.now(), // Temporary ID
        text: text.trim(),
        author: {
          id: authStore.user?.id ?? 0,
          name: authStore.user?.displayName ?? 'You',
        },
        date: new Date(),
        replyToId: replyToCommentId,
        replies: [],
      }

      queryClient.setQueryData<CommentThread>(
        queryKeys.comments.thread(channelId(), messageId()),
        (old) => {
          if (!old) {
            return {
              totalCount: 1,
              comments: [optimisticComment],
              hasMore: false,
            }
          }

          // Add to appropriate place in tree
          if (replyToCommentId) {
            return {
              ...old,
              totalCount: old.totalCount + 1,
              comments: addReplyToTree(
                old.comments,
                replyToCommentId,
                optimisticComment
              ),
            }
          }

          return {
            ...old,
            totalCount: old.totalCount + 1,
            comments: [optimisticComment, ...old.comments],
          }
        }
      )

      return { previous }
    },

    // Rollback on error
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.comments.thread(channelId(), messageId()),
          context.previous
        )
      }
    },

    // Refetch after mutation
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.comments.thread(channelId(), messageId()),
      })
    },
  }))
}

/**
 * Helper to check if an error is a CommentError with a specific code
 */
export function isCommentError(
  error: unknown,
  code?: CommentError['code']
): error is CommentError {
  if (!(error instanceof CommentError)) {
    return false
  }
  return code ? error.code === code : true
}

/**
 * Add a reply to the correct place in the comment tree
 *
 * Uses a Map-based approach for O(1) parent lookup instead of O(n) traversal.
 * Returns a new tree without mutating the original.
 */
function addReplyToTree(
  comments: Comment[],
  parentId: number,
  newComment: Comment
): Comment[] {
  // Build a map for O(1) lookup
  const commentMap = new Map<number, Comment>()
  const collectComments = (list: Comment[]) => {
    for (const comment of list) {
      commentMap.set(comment.id, comment)
      if (comment.replies?.length) {
        collectComments(comment.replies)
      }
    }
  }
  collectComments(comments)

  // Check if parent exists
  const parent = commentMap.get(parentId)
  if (!parent) {
    // Parent not found, add as root comment
    return [newComment, ...comments]
  }

  // Clone the tree with the new reply added
  const cloneWithReply = (list: Comment[]): Comment[] => {
    return list.map((comment) => {
      if (comment.id === parentId) {
        return {
          ...comment,
          replies: [...(comment.replies ?? []), newComment],
        }
      }
      if (comment.replies?.length) {
        return {
          ...comment,
          replies: cloneWithReply(comment.replies),
        }
      }
      return comment
    })
  }

  return cloneWithReply(comments)
}
