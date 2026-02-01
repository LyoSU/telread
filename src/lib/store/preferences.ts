import { createSignal, createRoot } from 'solid-js'
import { get, set } from 'idb-keyval'

export interface Preferences {
  // Feed settings
  showPreviews: boolean
  autoplayVideos: boolean
  compactMode: boolean
  showFolders: boolean
  hideArchived: boolean

  // Comment settings
  defaultExpandComments: boolean
  showCommentPreviews: number // 0 = none, -1 = all, N = first N

  // Notification settings
  notificationsEnabled: boolean
}

const DEFAULT_PREFERENCES: Preferences = {
  showPreviews: true,
  autoplayVideos: false,
  compactMode: false,
  showFolders: false,
  hideArchived: true,
  defaultExpandComments: false,
  showCommentPreviews: 3,
  notificationsEnabled: false,
}

const STORAGE_KEY = 'telread_preferences'

function createPreferencesStore() {
  const [preferences, setPreferencesInternal] =
    createSignal<Preferences>(DEFAULT_PREFERENCES)
  const [isLoaded, setIsLoaded] = createSignal(false)

  // Load from storage
  const load = async () => {
    try {
      const stored = await get<Preferences>(STORAGE_KEY)
      if (stored) {
        setPreferencesInternal({ ...DEFAULT_PREFERENCES, ...stored })
      }
    } catch {
      // Use defaults
    }
    setIsLoaded(true)
  }

  // Update a single preference
  const setPreference = async <K extends keyof Preferences>(
    key: K,
    value: Preferences[K]
  ) => {
    const updated = { ...preferences(), [key]: value }
    setPreferencesInternal(updated)
    try {
      await set(STORAGE_KEY, updated)
    } catch {
      // Ignore storage errors
    }
  }

  // Update multiple preferences
  const setPreferences = async (updates: Partial<Preferences>) => {
    const updated = { ...preferences(), ...updates }
    setPreferencesInternal(updated)
    try {
      await set(STORAGE_KEY, updated)
    } catch {
      // Ignore storage errors
    }
  }

  // Reset to defaults
  const reset = async () => {
    setPreferencesInternal(DEFAULT_PREFERENCES)
    try {
      await set(STORAGE_KEY, DEFAULT_PREFERENCES)
    } catch {
      // Ignore storage errors
    }
  }

  // Initialize
  load()

  return {
    get preferences() {
      return preferences()
    },
    get isLoaded() {
      return isLoaded()
    },
    setPreference,
    setPreferences,
    reset,
  }
}

export const preferencesStore = createRoot(createPreferencesStore)
