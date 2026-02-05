import { onMount, onCleanup, createMemo, createEffect, For, Show, createSignal } from 'solid-js'
import { Timeline } from '@/components/timeline'
import { useOptimizedTimeline } from '@/lib/query/hooks/useTimeline'
import { useFolderInfoList } from '@/lib/query/hooks/useFolders'
import { FolderChip } from '@/components/ui'
import { folderStore, setSelectedFolder } from '@/lib/store/folders'
import { channelsState, hasChannel, upsertChannel } from '@/lib/store/channels'
import { upsertPosts } from '@/lib/store/posts'
import { preferencesStore } from '@/lib/store/preferences'
import { getChannelIdsInFolder, type FolderInfo } from '@/lib/telegram/folders'
import { getChannel as fetchChannelApi } from '@/lib/telegram/channels'
import { fetchMessages } from '@/lib/telegram/messages'

/**
 * Home page - Unified timeline from all subscribed channels
 *
 * Clean Threads-style layout with sticky header and folder filters
 */
function Home() {
    const timeline = useOptimizedTimeline()

    // AbortController for cancelling in-flight folder sync requests
    let folderSyncAbortController: AbortController | null = null

    // Get ALL channel IDs for folder info (not filtered by folder)
    // Use channelsState directly for stable reactivity
    const allChannelIds = createMemo(() => {
        // Access channelsState.ids and spread to create new array reference
        // This ensures SolidJS tracks changes properly
        const ids = [...channelsState.ids]
        if (import.meta.env.DEV) {
            console.log('[Home] Channel IDs from store:', ids.length)
        }
        return ids
    })

    // Fetch folder info with channel counts based on ALL channels
    const foldersQuery = useFolderInfoList(allChannelIds)

    // Track if folders were loaded at least once to prevent hiding
    const [foldersEverLoaded, setFoldersEverLoaded] = createSignal(false)

    // Cache folders data locally to prevent UI flicker during refetching
    // Initialize with existing data if available to prevent flash on remount
    const [cachedFolders, setCachedFolders] = createSignal<FolderInfo[]>(
        foldersQuery.data ?? []
    )

    // Update cached folders when query data changes
    createEffect(() => {
        const folders = foldersQuery.data

        // Mark as loaded if we have folders
        if (folders && folders.length > 0) {
            if (!foldersEverLoaded()) {
                setFoldersEverLoaded(true)
                if (import.meta.env.DEV) {
                    console.log('[Home] Folders loaded for the first time!')
                }
            }
            // Cache valid folders data to prevent disappearing
            setCachedFolders(folders)
        }

        if (import.meta.env.DEV) {
            console.log('[Home] Folders query state:', {
                folders: folders?.length || 0,
                cachedFolders: cachedFolders()?.length || 0,
                channels: allChannelIds().length,
                isLoading: foldersQuery.isLoading,
                isFetching: foldersQuery.isFetching,
                everLoaded: foldersEverLoaded()
            })
        }
    })

    // Listen for home tap when already at top
    onMount(() => {
        const handleHomeTap = () => {
            if (timeline.pendingCount > 0) {
                // Show new posts first
                timeline.showNewPosts()
            } else {
                // No pending posts - refresh feed
                timeline.refresh()
            }
        }
        window.addEventListener('home-tap-top', handleHomeTap)
        onCleanup(() => window.removeEventListener('home-tap-top', handleHomeTap))
    })

    // Cleanup abort controller on unmount
    onCleanup(() => {
        folderSyncAbortController?.abort()
    })

    // Reset folder selection when folders are disabled
    createEffect(() => {
        const showFolders = preferencesStore.preferences.showFolders
        if (!showFolders && folderStore.selectedFolderId !== null) {
            setSelectedFolder(null, [])
            if (import.meta.env.DEV) {
                console.log('[Home] Folders disabled, resetting to All')
            }
        }
    })

    // Debug logging for folder state changes
    createEffect(() => {
        const folderId = folderStore.selectedFolderId
        const channelCount = folderStore.channelIdsInFolder.length
        if (import.meta.env.DEV) {
            console.log(`[Home] Folder state: ${folderId}, channels: ${channelCount}`)
        }
    })

    /**
     * Handle folder selection with race condition protection
     *
     * Uses AbortController to cancel in-flight sync tasks when user
     * rapidly switches between folders.
     */
    const handleFolderClick = async (folderId: number | null) => {
        if (import.meta.env.DEV) {
            console.log('[Home] Folder clicked:', folderId)
        }

        // Cancel any in-flight sync task
        folderSyncAbortController?.abort()
        const controller = new AbortController()
        folderSyncAbortController = controller
        const signal = controller.signal

        if (folderId === null) {
            // Clear folder
            setSelectedFolder(null, [])
            return
        }

        // Load channels first, then set folder
        try {
            if (import.meta.env.DEV) {
                console.log(`[Home] Pre-loading channels for folder ${folderId}...`)
            }
            const channelIds = await getChannelIdsInFolder(folderId)

            // Check if request was aborted (user switched folders)
            if (signal.aborted) {
                if (import.meta.env.DEV) {
                    console.log(`[Home] Folder ${folderId} load aborted - user switched`)
                }
                return
            }

            // Optimistic update: Switch folder immediately so UI feels responsive
            setSelectedFolder(folderId, channelIds)

            // Background sync: Ensure content is fresh
            // 1. Fetch missing channels (essential for them to appear)
            // 2. Refresh top visible channels (to show new posts)
            const missingIds = channelIds.filter(id => !hasChannel(id))
            const topIds = channelIds.slice(0, 10)
            const idsToSync = Array.from(new Set([...missingIds, ...topIds]))

            if (idsToSync.length > 0) {
                if (import.meta.env.DEV) {
                    console.log(`[Home] Background syncing ${idsToSync.length} channels for folder...`)
                }

                // Run in background with abort check
                const syncTask = async () => {
                    const fetchPromises = idsToSync.map(async (id) => {
                        // Check abort before each fetch
                        if (signal.aborted) return

                        try {
                            // 1. Fetch channel info if missing
                            if (!hasChannel(id)) {
                                const channel = await fetchChannelApi(id)
                                if (signal.aborted) return
                                if (channel) upsertChannel(channel)
                            }

                            // 2. Fetch fresh posts
                            const messages = await fetchMessages(id, { limit: 5 })
                            if (signal.aborted) return
                            if (messages.length > 0) {
                                upsertPosts(messages)
                            }
                        } catch (e) {
                            if (!signal.aborted && import.meta.env.DEV) {
                                console.warn(`[Home] Failed to sync channel ${id}:`, e)
                            }
                        }
                    })
                    await Promise.all(fetchPromises)

                    if (!signal.aborted && import.meta.env.DEV) {
                        console.log('[Home] Folder sync complete')
                    }
                }

                syncTask().catch(e => {
                    if (!signal.aborted) {
                        console.error('[Home] Sync task failed:', e)
                    }
                })
            }
        } catch (error) {
            if (!signal.aborted) {
                console.error('[Home] Failed to load folder channels:', error)
                // Set folder anyway, effect will try to load channels
                setSelectedFolder(folderId, [])
            }
        }
    }

    return (
        <div class="h-full">
            {/* Sticky header */}
            <div class="sticky top-0 z-20 bg-[var(--color-bg)]/80 backdrop-blur-xl border-b border-[var(--nav-border)]">
                <div class="flex items-center justify-center py-4">
                    <h1 class="text-[15px] font-semibold text-primary">Feed</h1>
                </div>

                {/* Folder chips - show if enabled in settings and we have folders */}
                <Show when={preferencesStore.preferences.showFolders && foldersEverLoaded() && (cachedFolders()?.length ?? 0) > 0}>
                    <div class="folder-chips-wrapper pb-3">
                        <div class="folder-chips-container">
                            {/* "All" chip */}
                            <FolderChip
                                id={null}
                                title="All"
                                emoticon="📱"
                                count={allChannelIds().length}
                                active={folderStore.selectedFolderId === null}
                                onClick={() => handleFolderClick(null)}
                            />

                            {/* Folder chips - use cached folders to prevent disappearing */}
                            <For each={cachedFolders()}>
                                {(folder) => (
                                    <FolderChip
                                        id={folder.id}
                                        title={folder.title}
                                        emoticon={folder.emoticon}
                                        count={folder.channelCount}
                                        active={folderStore.selectedFolderId === folder.id}
                                        onClick={() => handleFolderClick(folder.id)}
                                    />
                                )}
                            </For>
                        </div>
                    </div>
                </Show>
            </div>

            {/* Timeline */}
            <Timeline
                items={timeline.timeline}
                channels={timeline.allChannels}
                isLoading={timeline.isLoading}
                isLoadingMore={timeline.isLoadingMore}
                hasMore={timeline.hasMore}
                onLoadMore={timeline.loadMore}
                pendingCount={timeline.pendingCount}
                onShowNewPosts={timeline.showNewPosts}
                scrollKey="home"
            />
        </div>
    )
}

export default Home
