import { createStore } from 'solid-js/store'

/**
 * Store for folder selection state
 * 
 * Manages which folder is currently selected for filtering the timeline.
 * null means "All channels" (no filter)
 */
interface FolderStore {
    /** Currently selected folder ID, null = all channels */
    selectedFolderId: number | null
    /** IDs of channels in the selected folder (cached for performance) */
    channelIdsInFolder: number[]
}

const STORAGE_KEY = 'telread:selectedFolder'

// Load initial state from localStorage
function loadInitialState(): FolderStore {
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored) {
            const parsed = JSON.parse(stored)
            return {
                selectedFolderId: parsed.selectedFolderId ?? null,
                channelIdsInFolder: [],
            }
        }
    } catch (error) {
        if (import.meta.env.DEV) {
            console.warn('[FolderStore] Failed to load from localStorage:', error)
        }
    }

    return {
        selectedFolderId: null,
        channelIdsInFolder: [],
    }
}

const [folderStore, setFolderStore] = createStore<FolderStore>(loadInitialState())

/**
 * Set the selected folder
 * @param folderId - Folder ID to select, or null for "All channels"
 * @param channelIds - Optional array of channel IDs in this folder
 */
export function setSelectedFolder(folderId: number | null, channelIds: number[] = []) {
    setFolderStore({
        selectedFolderId: folderId,
        channelIdsInFolder: channelIds,
    })

    // Persist to localStorage
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ selectedFolderId: folderId }))
    } catch (error) {
        if (import.meta.env.DEV) {
            console.warn('[FolderStore] Failed to save to localStorage:', error)
        }
    }

    if (import.meta.env.DEV) {
        console.log('[FolderStore] Selected folder:', folderId, 'with', channelIds.length, 'channels')
    }
}

/**
 * Clear folder selection (show all channels)
 */
export function clearSelectedFolder() {
    setSelectedFolder(null, [])
}

/**
 * Update the channel IDs for the current folder
 * Used when folder channels are loaded asynchronously
 */
export function setFolderChannelIds(channelIds: number[]) {
    setFolderStore('channelIdsInFolder', channelIds)
}

export { folderStore }
