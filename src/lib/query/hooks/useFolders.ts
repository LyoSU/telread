import { createQuery } from '@tanstack/solid-query'
import { createMemo } from 'solid-js'
import { fetchDialogFilters, getFolderInfoList, type FolderInfo } from '@/lib/telegram'
import { queryKeys } from '../keys'

/**
 * Hook to fetch all Telegram folders (dialog filters)
 *
 * Folders are cached and only refreshed:
 * - On first load
 * - Manually by user
 * - Via real-time updates (future enhancement)
 */
export function useFolders() {
    return createQuery(() => ({
        queryKey: queryKeys.folders.list(),
        queryFn: () => fetchDialogFilters(),
        // Cache folders for a long time - they rarely change
        staleTime: 1000 * 60 * 60, // 1 hour
        gcTime: 1000 * 60 * 60 * 24, // 24 hours
    }))
}

/**
 * Create a stable hash from channel IDs for queryKey
 * This ensures cache invalidation when channels change, not just count
 */
function hashChannelIds(ids: number[]): string {
    if (ids.length === 0) return 'empty'
    // Use sorted first 10 IDs + count for a stable, lightweight key
    const sorted = [...ids].sort((a, b) => a - b)
    const sample = sorted.slice(0, 10).join(',')
    return `${ids.length}:${sample}`
}

/**
 * Hook to get folder info list with channel counts
 *
 * @param channelIds - Accessor returning array of all subscribed channel IDs
 * @returns Query with folder info including channel counts
 */
export function useFolderInfoList(channelIds: () => number[]) {
    return createQuery(() => ({
        // Use hash of channel IDs for stable but accurate cache key
        queryKey: ['folders', 'infoList', hashChannelIds(channelIds())],
        queryFn: () => getFolderInfoList(channelIds()),
        enabled: channelIds().length > 0,
        staleTime: 1000 * 60 * 5, // 5 minutes
        gcTime: 1000 * 60 * 60, // 1 hour
        // Keep previous data while refetching to prevent UI flicker
        placeholderData: (previousData: FolderInfo[] | undefined) => previousData,
    }))
}

/**
 * Hook to get a specific folder by ID
 *
 * @param folderId - Accessor returning the folder ID to get
 * @returns Memo with the folder data or undefined
 */
export function useFolder(folderId: () => number | null) {
    const foldersQuery = useFolders()

    return createMemo(() => {
        const id = folderId()
        if (id === null) return null
        return foldersQuery.data?.find(f => f.id === id)
    })
}
