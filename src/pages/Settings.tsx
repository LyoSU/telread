import { Show, createSignal } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { GlassCard, GlassButton, UserAvatar, ConfirmDialog, Toggle } from '@/components/ui'
import { themeStore, authStore, updateStore, preferencesStore, clearPosts, type Theme } from '@/lib/store'
import { logout, clearMediaCache } from '@/lib/telegram'
import { queryClient, queryKeys } from '@/lib/query'
import { keys, del } from 'idb-keyval'
import { Send, ChevronRight, RefreshCw, Check, FolderOpen, Archive, Trash2 } from 'lucide-solid'

/**
 * Settings page
 */
function Settings() {
  const navigate = useNavigate()
  const [showLogoutConfirm, setShowLogoutConfirm] = createSignal(false)

  const handleLogout = async () => {
    try {
      await logout()
    } catch (error) {
      console.error('Logout failed:', error)
      // Continue with logout anyway - user wants to leave
    }
    // Clear auth state (also clears auth hint for optimistic loading)
    authStore.setUser(null)
    navigate('/login')
  }

  const themeOptions: { value: Theme; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ]

  return (
    <div class="p-4 space-y-6 min-h-full pb-24">
      <h1 class="text-2xl font-semibold text-primary">
        Settings
      </h1>

      {/* Account section */}
      <div>
        <GlassCard class="p-4">
          <h2 class="text-sm font-semibold text-tertiary uppercase tracking-wide mb-4">
            Account
          </h2>

          <Show when={authStore.user}>
            <div class="flex items-center gap-4">
              <UserAvatar
                userId={authStore.user!.id}
                name={authStore.user!.displayName}
                size="lg"
              />
              <div class="flex-1 min-w-0">
                <p class="font-semibold text-primary">
                  {authStore.user!.displayName}
                </p>
                <Show when={authStore.user!.username}>
                  <p class="text-sm text-secondary">
                    @{authStore.user!.username}
                  </p>
                </Show>
              </div>
            </div>
          </Show>

          <div class="mt-4 pt-4 border-t border-[var(--glass-border)]">
            <GlassButton
              variant="danger"
              onClick={() => setShowLogoutConfirm(true)}
              class="w-full"
            >
              Log Out
            </GlassButton>
          </div>
        </GlassCard>

        {/* Logout confirmation */}
        <ConfirmDialog
          open={showLogoutConfirm()}
          onClose={() => setShowLogoutConfirm(false)}
          onConfirm={handleLogout}
          title="Log out?"
          description="You'll need to sign in again to access your channels."
          confirmText="Log Out"
          variant="danger"
        />
      </div>

      {/* Feed section */}
      <div>
        <GlassCard class="p-4">
          <h2 class="text-sm font-semibold text-tertiary uppercase tracking-wide mb-4">
            Feed
          </h2>

          <div class="space-y-4">
            {/* Folders toggle */}
            <div class="flex items-center justify-between gap-4">
              <div class="flex items-center gap-3 flex-1 min-w-0">
                <div class="w-9 h-9 rounded-xl bg-[var(--accent)]/15 flex items-center justify-center flex-shrink-0">
                  <FolderOpen size={18} class="text-accent" />
                </div>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-primary">Show Folders</p>
                  <p class="text-xs text-tertiary">Filter feed by Telegram folders</p>
                </div>
              </div>
              <Toggle
                checked={preferencesStore.preferences.showFolders}
                onChange={(checked) => preferencesStore.setPreference('showFolders', checked)}
              />
            </div>

            {/* Hide archived toggle */}
            <div class="flex items-center justify-between gap-4">
              <div class="flex items-center gap-3 flex-1 min-w-0">
                <div class="w-9 h-9 rounded-xl bg-[var(--warning)]/15 flex items-center justify-center flex-shrink-0">
                  <Archive size={18} class="text-[var(--warning)]" />
                </div>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-primary">Hide Archived</p>
                  <p class="text-xs text-tertiary">Don't show archived channels</p>
                </div>
              </div>
              <Toggle
                checked={preferencesStore.preferences.hideArchived}
                onChange={(checked) => preferencesStore.setPreference('hideArchived', checked)}
              />
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Appearance section */}
      <div>
        <GlassCard class="p-4">
          <h2 class="text-sm font-semibold text-tertiary uppercase tracking-wide mb-4">
            Appearance
          </h2>

          <div class="space-y-4">
            {/* Theme selector */}
            <div>
              <label class="text-sm font-medium text-primary mb-2 block">
                Theme
              </label>
              <div class="grid grid-cols-3 gap-2">
                {themeOptions.map((option) => (
                  <button
                    onClick={() => themeStore.setTheme(option.value)}
                    class={`
                      p-3 rounded-2xl text-sm font-medium transition-all
                      ${
                        themeStore.theme === option.value
                          ? 'bg-[var(--accent)] text-white shadow-[0_2px_8px_rgba(0,122,255,0.3)]'
                          : 'bg-[var(--pill-bg)] hover:bg-[var(--pill-bg-hover)] text-secondary'
                      }
                    `}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Data section */}
      <div>
        <GlassCard class="p-4">
          <h2 class="text-sm font-semibold text-tertiary uppercase tracking-wide mb-4">
            Data
          </h2>

          <div class="space-y-3">
            {/* Refresh channels */}
            <button
              onClick={async () => {
                // Clear all caches and refetch — no page reload needed
                clearPosts()
                await queryClient.invalidateQueries({ queryKey: queryKeys.timeline.all })
                await queryClient.invalidateQueries({ queryKey: queryKeys.channels.all })
                await queryClient.invalidateQueries({ queryKey: queryKeys.folders.all })
                await queryClient.refetchQueries({ queryKey: queryKeys.channels.all })
                await queryClient.refetchQueries({ queryKey: queryKeys.timeline.all })
              }}
              class="w-full flex items-center gap-3 p-3 rounded-xl bg-[var(--pill-bg)] hover:bg-[var(--pill-bg-hover)] transition-colors text-left"
            >
              <div class="w-9 h-9 rounded-xl bg-[var(--accent)]/15 flex items-center justify-center flex-shrink-0">
                <RefreshCw size={18} class="text-accent" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-primary">Refresh Channels</p>
                <p class="text-xs text-tertiary">Reload all channels and archived status</p>
              </div>
            </button>

            {/* Clear cache */}
            <button
              onClick={async () => {
                // Clear IndexedDB caches (query cache + media) but keep user settings
                const allKeys = await keys()
                const cacheKeys = allKeys.filter((k): k is string =>
                  typeof k === 'string' && (
                    k === 'telread-query-cache' ||
                    k.startsWith('media-thumb:') ||
                    k.startsWith('profile-photo:')
                  )
                )
                await Promise.all(cacheKeys.map(k => del(k)))
                // Clear in-memory media caches and revoke blob URLs
                clearMediaCache()
                // Clear query client
                queryClient.clear()
                clearPosts()
                // Reload
                window.location.reload()
              }}
              class="w-full flex items-center gap-3 p-3 rounded-xl bg-[var(--pill-bg)] hover:bg-[var(--pill-bg-hover)] transition-colors text-left"
            >
              <div class="w-9 h-9 rounded-xl bg-[var(--error)]/15 flex items-center justify-center flex-shrink-0">
                <Trash2 size={18} class="text-[var(--error)]" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-primary">Clear Cache</p>
                <p class="text-xs text-tertiary">Delete all cached data and reload</p>
              </div>
            </button>
          </div>
        </GlassCard>
      </div>

      {/* About section */}
      <div>
        <GlassCard class="p-4">
          <h2 class="text-sm font-semibold text-tertiary uppercase tracking-wide mb-4">
            About
          </h2>

          {/* Version & Update */}
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-primary">TelRead</p>
              <p class="text-xs text-tertiary">
                Built {new Date(__BUILD_TIME__).toLocaleString(undefined, { 
                  month: 'short', 
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
            </div>
            
            <Show
              when={updateStore.updateAvailable}
              fallback={
                <div class="flex items-center gap-1.5 text-xs text-tertiary">
                  <Check size={14} />
                  <span>Up to date</span>
                </div>
              }
            >
              <GlassButton
                variant="primary"
                size="sm"
                onClick={() => updateStore.applyUpdate()}
                disabled={updateStore.isUpdating}
                class="flex items-center gap-1.5"
              >
                <RefreshCw size={14} class={updateStore.isUpdating ? 'animate-spin' : ''} />
                {updateStore.isUpdating ? 'Updating...' : 'Update'}
              </GlassButton>
            </Show>
          </div>
        </GlassCard>
      </div>

      {/* Author */}
      <a
        href="https://t.me/lyblog"
        target="_blank"
        rel="noopener noreferrer"
        class="block"
      >
        <GlassCard class="p-4 hover:bg-[var(--glass-bg-elevated)] transition-colors">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full bg-[var(--accent)]/15 flex items-center justify-center">
              <Send size={20} class="text-accent" />
            </div>
            <div class="flex-1">
              <p class="text-sm font-medium text-primary">@lyblog</p>
              <p class="text-xs text-tertiary">Author's channel</p>
            </div>
            <ChevronRight size={20} class="text-tertiary" />
          </div>
        </GlassCard>
      </a>
    </div>
  )
}

export default Settings
