import { createQuery, createMutation } from '@tanstack/solid-query'
import { createMemo, createEffect, on } from 'solid-js'
import { getMessage, sendReaction, getAvailableReactions, type Message } from '@/lib/telegram'
import { updatePostReactionsImmediate, getPost, upsertPosts, postsState } from '@/lib/store'
import { queryClient } from '../client'
import { queryKeys } from '../keys'
import type { TimelineData } from './useTimeline'

/**
 * Hook to fetch a single post/message
 *
 * Uses postsState store as primary source (instant, reactive).
 * Falls back to API fetch only when post is not in store.
 * Seeds query cache from store so post survives store GC eviction.
 */
export function usePost(
  channelId: () => number,
  messageId: () => number,
  enabled?: () => boolean
) {
  // Reactive lookup from store - instant when post exists
  const storePost = createMemo(() => {
    const cid = channelId()
    const mid = messageId()
    if (cid === 0 || mid === 0) return undefined
    return postsState.byId[`${cid}:${mid}`] as Message | undefined
  })

  // Seed query cache from store when navigating to a post.
  // This prevents the post from disappearing when store GC (trimToMaxPosts)
  // evicts it under MAX_POSTS pressure while the user is viewing it.
  // Without this, storePost() → undefined AND query.data → undefined → spinner + scroll jump.
  createEffect(on(
    () => [channelId(), messageId()] as const,
    ([cid, mid]) => {
      if (cid === 0 || mid === 0) return
      const key = queryKeys.messages.detail(cid, mid)
      if (queryClient.getQueryData(key)) return
      const post = postsState.byId[`${cid}:${mid}`] as Message | undefined
      if (post) {
        queryClient.setQueryData(key, post)
      }
    }
  ))

  // Query only runs if post is NOT in store
  const query = createQuery(() => {
    const cid = channelId()
    const mid = messageId()
    const isValid = cid !== 0 && mid !== 0
    const hasStoreData = !!storePost()

    return {
      queryKey: queryKeys.messages.detail(cid, mid),
      queryFn: async () => {
        // Double-check store
        const fromStore = getPost(cid, mid)
        if (fromStore) return fromStore

        // Check timeline lastMessage
        const timelineData = queryClient.getQueryData<TimelineData>(queryKeys.timeline.all)
        const channel = timelineData?.channels.find(c => c.id === cid)
        if (channel?.lastMessage?.id === mid) {
          upsertPosts([channel.lastMessage])
          return channel.lastMessage
        }

        // Fetch from API
        const post = await getMessage(cid, mid)
        if (post) upsertPosts([post])
        return post
      },
      staleTime: 1000 * 60 * 30,
      // Only fetch if: enabled AND valid IDs AND NOT already in store
      enabled: (enabled?.() ?? true) && isValid && !hasStoreData,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    }
  })

  // Return combined result - prefer store, fallback to query
  return {
    get data() { return storePost() ?? query.data },
    get isLoading() { return !storePost() && query.isLoading },
    get isError() { return !storePost() && query.isError },
    get error() { return query.error },
    refetch: query.refetch,
  }
}

/**
 * Hook to fetch available reactions for a channel
 */
export function useAvailableReactions(channelId: () => number) {
  return createQuery(() => ({
    queryKey: ['reactions', 'available', channelId()],
    queryFn: () => getAvailableReactions(channelId()),
    enabled: channelId() !== 0,
    staleTime: 1000 * 60 * 60, // 1 hour - reactions don't change often
  }))
}

/**
 * Mutation hook to toggle a reaction on a message
 * Supports multiple reactions per user
 * Uses optimistic updates for instant UI feedback
 */
export function useSendReaction() {
  return createMutation(() => ({
    mutationFn: async ({
      channelId,
      messageId,
      emoji,
      currentChosenEmojis,
    }: {
      channelId: number
      messageId: number
      emoji: string
      currentChosenEmojis: string[]
      currentReactions: Array<{ emoji: string; count: number; chosen?: boolean }>
    }) => {
      // Just send to API - optimistic update handled in onMutate
      await sendReaction(channelId, messageId, emoji, currentChosenEmojis)
      return { channelId, messageId }
    },
    
    // Optimistic update - runs before mutationFn
    onMutate: async ({ channelId, messageId, emoji, currentChosenEmojis, currentReactions }) => {
      const isChosen = currentChosenEmojis.includes(emoji)
      const optimisticReactions = calculateOptimisticReactions(
        currentReactions,
        emoji,
        isChosen
      )
      
      // Update store (timeline reads from store)
      updatePostReactionsImmediate(channelId, messageId, optimisticReactions)
      
      // Update post detail query cache (Post.tsx reads from this)
      queryClient.setQueryData<Message>(
        queryKeys.messages.detail(channelId, messageId),
        (old) => old ? { ...old, reactions: optimisticReactions } : old
      )
      
      // Return context for rollback
      return { previousReactions: currentReactions }
    },
    
    onError: (_err, { channelId, messageId }, context) => {
      // Rollback to original reactions on error
      if (context?.previousReactions) {
        updatePostReactionsImmediate(channelId, messageId, context.previousReactions)
        queryClient.setQueryData<Message>(
          queryKeys.messages.detail(channelId, messageId),
          (old) => old ? { ...old, reactions: context.previousReactions } : old
        )
      }
    },
    
    // No onSuccess needed - raw updates from server will sync final state
  }))
}

/**
 * Calculate what reactions should look like after toggling an emoji
 */
function calculateOptimisticReactions(
  currentReactions: Array<{ emoji: string; count: number; chosen?: boolean }>,
  emoji: string,
  wasChosen: boolean
): Array<{ emoji: string; count: number; chosen?: boolean }> {
  const reactions = [...currentReactions]
  const existingIndex = reactions.findIndex(r => r.emoji === emoji)
  
  if (wasChosen) {
    // Removing reaction
    if (existingIndex >= 0) {
      const newCount = reactions[existingIndex].count - 1
      if (newCount <= 0) {
        // Remove reaction entirely
        reactions.splice(existingIndex, 1)
      } else {
        reactions[existingIndex] = {
          ...reactions[existingIndex],
          count: newCount,
          chosen: false,
        }
      }
    }
  } else {
    // Adding reaction
    if (existingIndex >= 0) {
      reactions[existingIndex] = {
        ...reactions[existingIndex],
        count: reactions[existingIndex].count + 1,
        chosen: true,
      }
    } else {
      // New reaction
      reactions.push({ emoji, count: 1, chosen: true })
    }
  }
  
  return reactions
}
