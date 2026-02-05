import { createQuery, createMutation, useQueryClient } from '@tanstack/solid-query'
import { createMemo } from 'solid-js'
import {
  fetchChannels,
  joinChannel,
  leaveChannel,
  getChannel,
  getChannelFullInfo,
  type Channel,
} from '@/lib/telegram'
import { queryKeys } from '../keys'

/**
 * Hook to fetch all subscribed channels
 *
 * Channels are cached persistently and only refreshed:
 * - On first load (if no cached data)
 * - Via real-time updates when new messages arrive
 * - Manually by user action
 */
export function useChannels() {
  return createQuery(() => ({
    queryKey: queryKeys.channels.list(),
    queryFn: () => fetchChannels(),
    // Never auto-refetch - updates come from real-time listener
    staleTime: Infinity,
    // Keep in cache for 7 days
    gcTime: 1000 * 60 * 60 * 24 * 7,
  }))
}

/**
 * Hook to fetch a single channel by ID
 *
 * First checks the cached channels list, then fetches if not found.
 */
export function useChannel(channelId: () => number) {
  const queryClient = useQueryClient()

  return createQuery(() => ({
    queryKey: queryKeys.channels.detail(channelId()),
    queryFn: async () => {
      const id = channelId()

      // First try to find in cached channels list
      const cachedChannels = queryClient.getQueryData<Channel[]>(queryKeys.channels.list())
      const cached = cachedChannels?.find((c) => c.id === id)
      if (cached) return cached

      // Otherwise fetch from API
      const channel = await getChannel(id)
      return channel
    },
    enabled: channelId() !== 0,
    staleTime: 1000 * 60 * 60, // 1 hour
    refetchOnMount: false, // Use cache if available
  }))
}

/**
 * Hook to join a channel
 */
export function useJoinChannel() {
  const queryClient = useQueryClient()

  return createMutation(() => ({
    mutationFn: (usernameOrLink: string) => joinChannel(usernameOrLink),
    onSuccess: (channel) => {
      if (channel) {
        // Add to channels list
        queryClient.setQueryData<Channel[]>(queryKeys.channels.list(), (old) =>
          old ? [channel, ...old] : [channel]
        )
      }
    },
  }))
}

/**
 * Hook to leave a channel
 */
export function useLeaveChannel() {
  const queryClient = useQueryClient()

  return createMutation(() => ({
    mutationFn: (channelId: number) => leaveChannel(channelId),
    onSuccess: (_, channelId) => {
      // Remove from channels list
      queryClient.setQueryData<Channel[]>(queryKeys.channels.list(), (old) =>
        old ? old.filter((c) => c.id !== channelId) : []
      )
    },
  }))
}

/**
 * Hook to fetch full channel info (description, stats, etc.)
 *
 * Used for the channel profile card/header.
 * Fetches additional data not available in the channels list.
 */
export function useChannelInfo(channelId: () => number) {
  return createQuery(() => ({
    queryKey: queryKeys.channels.fullInfo(channelId()),
    queryFn: () => getChannelFullInfo(channelId()),
    enabled: channelId() !== 0,
    staleTime: 1000 * 60 * 30, // 30 minutes - channel info rarely changes
    gcTime: 1000 * 60 * 60, // 1 hour in cache
    refetchOnMount: false, // Use cache if available
  }))
}

/**
 * Hook to resolve channel by ID or username
 * 
 * Checks subscribed channels cache first, then fetches from API.
 * Returns reactive channelId for dependent queries.
 */
export function useResolveChannel(idOrUsername: () => string | number | undefined) {
  const queryClient = useQueryClient()

  const query = createQuery(() => {
    const value = idOrUsername()
    return {
      queryKey: queryKeys.channels.resolve(String(value ?? '')),
      queryFn: async (): Promise<Channel | null> => {
        if (!value) return null

        // Check subscribed channels cache first
        const cached = queryClient.getQueryData<Channel[]>(queryKeys.channels.list())
        const found = typeof value === 'number'
          ? cached?.find((c) => c.id === value)
          : cached?.find((c) => c.username?.toLowerCase() === value.toLowerCase())
        
        if (found) return found

        // Not in subscriptions - fetch from API
        return getChannel(value)
      },
      enabled: !!value,
      staleTime: 1000 * 60 * 5, // 5 minutes - avoid redundant API calls
      gcTime: 1000 * 60 * 60,
      retry: 2,
      refetchOnMount: false, // Use cache if available for mobile bandwidth savings
    }
  })

  const channelId = createMemo(() => query.data?.id ?? 0)

  return {
    get data() { return query.data },
    get isLoading() { return query.isLoading },
    get isError() { return query.isError },
    get error() { return query.error },
    get isSuccess() { return query.isSuccess },
    get isFetching() { return query.isFetching },
    get channelId() { return channelId() },
    refetch: query.refetch,
  }
}
