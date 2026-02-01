import { createQuery, createMutation } from '@tanstack/solid-query'
import { getMessage, sendReaction, getAvailableReactions, type Message } from '@/lib/telegram'
import { updatePostReactionsImmediate, getPost, upsertPosts } from '@/lib/store'
import { queryClient } from '../client'
import { queryKeys } from '../keys'
import type { TimelineData } from './useTimeline'

/**
 * Hook to fetch a single post/message
 * Checks multiple cache levels before making API call:
 * 1. postsState (RAM) - fastest
 * 2. TanStack Query cache (may be from IndexedDB) 
 * 3. Timeline channels lastMessage
 * 4. API call (slowest)
 */
export function usePost(
  channelId: () => number,
  messageId: () => number,
  enabled?: () => boolean
) {
  return createQuery(() => {
    const cid = channelId()
    const mid = messageId()
    
    // Check store synchronously for instant display
    const cachedPost = getPost(cid, mid)
    
    return {
      queryKey: queryKeys.messages.detail(cid, mid),
      queryFn: async () => {
        // Double-check store (may have been populated since query started)
        const fromStore = getPost(cid, mid)
        if (fromStore) return fromStore
        
        // Check timeline cache - might have this post as lastMessage
        const timelineData = queryClient.getQueryData<TimelineData>(queryKeys.timeline.all)
        if (timelineData) {
          const channel = timelineData.channels.find(c => c.id === cid)
          if (channel?.lastMessage?.id === mid) {
            upsertPosts([channel.lastMessage])
            return channel.lastMessage
          }
        }
        
        // Fallback to API
        const post = await getMessage(cid, mid)
        if (post) {
          upsertPosts([post])
        }
        return post
      },
      // Instant display from store - no loading state if data exists
      initialData: cachedPost,
      // Tell TanStack Query the cached data is fresh (just loaded from timeline)
      initialDataUpdatedAt: cachedPost ? Date.now() : undefined,
      staleTime: 1000 * 60 * 30, // 30 minutes
      enabled: enabled?.() ?? true,
      refetchOnMount: false,
    }
  })
}

/**
 * Prefetch a post for navigation
 */
export function usePrefetchPost(queryClient: {
  prefetchQuery: (options: object) => Promise<void>
}) {
  return (channelId: number, messageId: number) => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.messages.detail(channelId, messageId),
      queryFn: () => getMessage(channelId, messageId),
    })
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
