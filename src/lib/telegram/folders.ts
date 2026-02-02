import { getTelegramClient } from './client'
import type { tl } from '@mtcute/web'
import { TIMING } from '@/config/constants'

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Cache TTL for dialog filters (5 minutes - folders rarely change) */
const FILTERS_CACHE_TTL_MS = TIMING.QUERY_STALE_TIME

/** Cache TTL for folder channel IDs (5 minutes) */
const FOLDER_CHANNELS_CACHE_TTL_MS = TIMING.QUERY_STALE_TIME

/** Maximum dialogs to iterate when fetching broadcast channels */
const MAX_DIALOGS_TO_ITERATE = 200

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Telegram Dialog Filter (Folder)
 */
export interface DialogFilter {
    id: number
    title: string
    /** Emoji icon for the folder */
    emoticon?: string
    /** Pinned chat IDs in this folder */
    pinnedPeers: number[]
    /** Included chat IDs */
    includePeers: number[]
    /** Excluded chat IDs */
    excludePeers: number[]
    /** Include contacts */
    contacts?: boolean
    /** Include non-contacts */
    nonContacts?: boolean
    /** Include groups */
    groups?: boolean
    /** Include channels/broadcasts */
    broadcasts?: boolean
    /** Include bots */
    bots?: boolean
    /** Exclude muted chats */
    excludeMuted?: boolean
    /** Exclude read chats */
    excludeRead?: boolean
    /** Exclude archived chats */
    excludeArchived?: boolean
}

/**
 * Simplified folder info for UI
 */
export interface FolderInfo {
    id: number
    title: string
    emoticon?: string
    /** Number of channels in this folder (calculated) */
    channelCount?: number
}

interface CacheEntry<T> {
    data: T
    timestamp: number
}

// ═══════════════════════════════════════════════════════════════════════════
// Cache
// ═══════════════════════════════════════════════════════════════════════════

let filtersCache: DialogFilter[] | null = null
let filtersCacheTime = 0

/** Cache for channel IDs per folder */
const folderChannelsCache = new Map<number, CacheEntry<number[]>>()

/** Cache for broadcast channel IDs (expensive to compute) */
let broadcastChannelsCache: CacheEntry<number[]> | null = null

/**
 * Manually clear the folders cache
 * Used when receiving real-time updates about folder changes
 */
export function clearFoldersCache(): void {
    filtersCache = null
    filtersCacheTime = 0
    folderChannelsCache.clear()
    broadcastChannelsCache = null
}

// ═══════════════════════════════════════════════════════════════════════════
// API Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch all dialog filters (folders) from Telegram
 *
 * Returns list of user's folders with their settings.
 * Folders are what Telegram calls "Dialog Filters" in the API.
 *
 * @param force - If true, bypasses memory cache and forces network request
 */
export async function fetchDialogFilters(force: boolean = false): Promise<DialogFilter[]> {
    // Return cached data if valid and not forced
    if (!force && filtersCache && (Date.now() - filtersCacheTime < FILTERS_CACHE_TTL_MS)) {
        if (import.meta.env.DEV) {
            console.log('[Folders] Using cached filters')
        }
        return filtersCache
    }

    const client = getTelegramClient()

    try {
        const result = await client.call({
            _: 'messages.getDialogFilters',
        })

        if (!result || !('filters' in result)) {
            return []
        }

        const filters: DialogFilter[] = []

        for (const filter of result.filters) {
            // Skip the "All Chats" filter (id = 0)
            if (filter._ === 'dialogFilter' && filter.id !== 0) {
                filters.push(mapDialogFilter(filter))
            }
        }

        if (import.meta.env.DEV) {
            console.log(`[Folders] Fetched ${filters.length} folders`)
        }

        // Update cache
        filtersCache = filters
        filtersCacheTime = Date.now()

        return filters
    } catch (error) {
        if (import.meta.env.DEV) {
            console.error('[Folders] Failed to fetch dialog filters:', error)
        }
        return []
    }
}

/**
 * Get list of channel IDs that belong to a specific folder
 * Results are cached to avoid expensive API calls on every folder switch
 *
 * @param folderId - The folder ID to get channels from
 * @returns Array of channel IDs in this folder
 */
export async function getChannelIdsInFolder(folderId: number): Promise<number[]> {
    // Check cache first
    const cached = folderChannelsCache.get(folderId)
    if (cached && (Date.now() - cached.timestamp < FOLDER_CHANNELS_CACHE_TTL_MS)) {
        if (import.meta.env.DEV) {
            console.log(`[Folders] Using cached channel IDs for folder ${folderId}: ${cached.data.length} channels`)
        }
        return cached.data
    }

    try {
        // Get all filters first
        const filters = await fetchDialogFilters()

        // Find the specific folder
        const folder = filters.find(f => f.id === folderId)
        if (!folder) {
            if (import.meta.env.DEV) {
                console.warn(`[Folders] Folder ${folderId} not found`)
            }
            return []
        }

        if (import.meta.env.DEV) {
            console.log(`[Folders] Folder "${folder.title}": ${folder.includePeers.length} included peers, broadcasts=${folder.broadcasts}`)
        }

        let channelIds: number[]

        // If folder uses broadcasts flag, we need to get all channels
        // Otherwise use the explicit includePeers list
        if (folder.broadcasts && folder.includePeers.length === 0) {
            channelIds = await fetchBroadcastChannelIds()
        } else {
            // Use explicit includePeers list
            channelIds = convertBareIdsToMarked(folder.includePeers, folder.title)
        }

        // Cache the result
        folderChannelsCache.set(folderId, {
            data: channelIds,
            timestamp: Date.now()
        })

        return channelIds
    } catch (error) {
        if (import.meta.env.DEV) {
            console.error(`[Folders] Failed to get channels in folder ${folderId}:`, error)
        }
        return []
    }
}

/**
 * Fetch all broadcast channel IDs by iterating dialogs
 * Used when folder has broadcasts=true but no explicit includePeers
 * Results are cached since this is an expensive operation
 */
async function fetchBroadcastChannelIds(): Promise<number[]> {
    // Check cache first - this is expensive!
    if (broadcastChannelsCache && (Date.now() - broadcastChannelsCache.timestamp < FOLDER_CHANNELS_CACHE_TTL_MS)) {
        if (import.meta.env.DEV) {
            console.log(`[Folders] Using cached broadcast channels: ${broadcastChannelsCache.data.length}`)
        }
        return broadcastChannelsCache.data
    }

    const client = getTelegramClient()
    const channelIds: number[] = []

    try {
        const iterator = client.iterDialogs()[Symbol.asyncIterator]()
        let count = 0

        while (count < MAX_DIALOGS_TO_ITERATE) {
            try {
                const { value: dialog, done } = await iterator.next()
                if (done) break
                count++

                const peer = dialog.peer
                if (peer.type === 'chat') {
                    const chat = peer as { chatType?: string; id: number }
                    if (chat.chatType === 'channel' && !isGroupChat(chat)) {
                        channelIds.push(chat.id)
                    }
                }
            } catch (iterError) {
                // Log individual iteration errors but continue
                if (import.meta.env.DEV) {
                    console.warn('[Folders] Error iterating dialog:', iterError)
                }
                break
            }
        }

        if (import.meta.env.DEV) {
            console.log(`[Folders] Found ${channelIds.length} broadcast channels (broadcasts flag)`)
        }

        // Cache the result
        broadcastChannelsCache = {
            data: channelIds,
            timestamp: Date.now()
        }

        return channelIds
    } catch (error) {
        if (import.meta.env.DEV) {
            console.error('[Folders] Failed to fetch broadcast channels:', error)
        }
        return channelIds // Return whatever we collected before error
    }
}

/**
 * Convert bare peer IDs to marked channel IDs
 *
 * IMPORTANT: includePeers contains bare peer IDs (positive numbers)
 * We need to convert them to marked channel IDs (negative with -100 prefix)
 * Telegram format: -100 + bare_id
 */
function convertBareIdsToMarked(includePeers: number[], folderTitle: string): number[] {
    const bareIds = includePeers.filter(id => id > 0)

    if (import.meta.env.DEV) {
        console.log(`[Folders] Processing ${bareIds.length} bare IDs from folder ${folderTitle}`)
    }

    const channelIds = bareIds.map(bareId => {
        const markedId = Number(`-100${bareId}`)
        if (isNaN(markedId)) {
            if (import.meta.env.DEV) {
                console.warn(`[Folders] Failed to convert bare ID ${bareId} to marked ID`)
            }
            return 0
        }
        return markedId
    }).filter(id => id !== 0)

    if (import.meta.env.DEV) {
        console.log(`[Folders] Folder "${folderTitle}": mapped to ${channelIds.length} channel IDs`)
        if (channelIds.length > 0) {
            console.log(`[Folders] IDs sample: ${channelIds.slice(0, 3).join(', ')}`)
        }
    }

    return channelIds
}

/**
 * Get simplified folder info list for UI
 * Includes channel count for each folder
 */
export async function getFolderInfoList(allChannelIds: number[]): Promise<FolderInfo[]> {
    const filters = await fetchDialogFilters()
    const folderInfos: FolderInfo[] = []

    for (const filter of filters) {
        // Calculate how many of user's subscribed channels are in this folder
        const channelCount = countChannelsInFilter(filter, allChannelIds)

        folderInfos.push({
            id: filter.id,
            title: filter.title,
            emoticon: filter.emoticon,
            channelCount,
        })
    }

    return folderInfos
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Map Telegram DialogFilter to our interface
 */
function mapDialogFilter(filter: tl.RawDialogFilter): DialogFilter {
    // Extract title as string - it can be RawTextWithEntities
    const title = typeof filter.title === 'string'
        ? filter.title
        : filter.title?.text || 'Untitled'

    // Extract emoticon if present
    const emoticon = filter.emoticon || undefined

    return {
        id: filter.id,
        title,
        emoticon,
        pinnedPeers: extractPeerIds(filter.pinnedPeers || []),
        includePeers: extractPeerIds(filter.includePeers || []),
        excludePeers: extractPeerIds(filter.excludePeers || []),
        contacts: filter.contacts,
        nonContacts: filter.nonContacts,
        groups: filter.groups,
        broadcasts: filter.broadcasts,
        bots: filter.bots,
        excludeMuted: filter.excludeMuted,
        excludeRead: filter.excludeRead,
        excludeArchived: filter.excludeArchived,
    }
}

/**
 * Extract peer IDs from InputPeer array
 * Safely handles parsing of different number types
 */
function extractPeerIds(peers: tl.TypeInputPeer[]): number[] {
    const ids: number[] = []

    for (const peer of peers) {
        try {
            let id: number | null = null

            if ('channelId' in peer && peer.channelId) {
                id = Number(peer.channelId.toString())
            } else if ('chatId' in peer && peer.chatId) {
                id = Number(peer.chatId.toString())
            } else if ('userId' in peer && peer.userId) {
                id = Number(peer.userId.toString())
            }

            if (id !== null && !isNaN(id)) {
                ids.push(id)
            }
        } catch (e) {
            if (import.meta.env.DEV) {
                console.warn('[Folders] Failed to extract peer ID:', e)
            }
        }
    }

    return ids
}

/**
 * Count how many channels from the given list are in this filter
 */
function countChannelsInFilter(filter: DialogFilter, channelIds: number[]): number {
    // If filter explicitly includes peers, check intersection
    if (filter.includePeers.length > 0) {
        return channelIds.filter(id => filter.includePeers.includes(id)).length
    }

    // If filter uses broadcasts flag, count all channels
    if (filter.broadcasts) {
        return channelIds.length
    }

    return 0
}

/**
 * Check if a chat is a group (supergroup/megagroup) rather than a broadcast channel
 */
function isGroupChat(chat: { chatType?: string }): boolean {
    return chat.chatType === 'supergroup' || chat.chatType === 'gigagroup'
}
