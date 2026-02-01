import { Show, createSignal } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Motion } from 'solid-motionone'
import { GlassCard, GlassButton, UserAvatar, ConfirmDialog } from '@/components/ui'
import { themeStore, authStore, updateStore, type Theme } from '@/lib/store'
import { logout } from '@/lib/telegram'
import { Send, ChevronRight, RefreshCw, Check } from 'lucide-solid'

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
      <Motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
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
      </Motion.div>

      {/* Appearance section */}
      <Motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
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
      </Motion.div>


      {/* About section */}
      <Motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
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
      </Motion.div>

      {/* Author */}
      <Motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
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
      </Motion.div>
    </div>
  )
}

export default Settings
