import { type ParentProps, type JSX, Show } from 'solid-js'
import { A, useLocation, useNavigate } from '@solidjs/router'
import { authStore, updateStore } from '@/lib/store'
import { haptic } from '@/lib/utils'
import { UserAvatar, PageTransition } from '@/components/ui'
import { Home, Search, Bookmark, User, MessageCircle } from 'lucide-solid'

/** Small dot badge for update indicator */
function UpdateBadge() {
  return (
    <Show when={updateStore.updateAvailable}>
      <span class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-[var(--accent)] rounded-full border-2 border-[var(--bg-primary)]" />
    </Show>
  )
}

/**
 * Main application layout - Threads-style design
 *
 * Responsive layout:
 * - Desktop (lg+): Threads-style icon sidebar on the left
 * - Mobile (< lg): Floating bottom navigation pill
 */
export function MainLayout(props: ParentProps) {
  const location = useLocation()
  const navigate = useNavigate()
  let mainRef: HTMLElement | undefined

  const handleHomeClick = () => {
    haptic('light')
    // Find the actual scroll container robustly
    const scrollEl = mainRef ?? document.querySelector('.main-scroll-container') as HTMLElement | null
    if (scrollEl && scrollEl.scrollTop > 0) {
      scrollEl.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      // At top or no scroll — trigger refresh
      window.dispatchEvent(new CustomEvent('home-tap-top'))
    }
  }

  /** Navigate to home or handle home-tap if already there */
  const handleHomeTap = () => {
    haptic('light')
    if (location.pathname === '/') {
      handleHomeClick()
    } else {
      navigate('/')
    }
  }

  const handleNavClick = () => {
    haptic('light')
  }

  const navItems: Array<{
    path: string
    label: string
    icon: (active: boolean) => JSX.Element
  }> = [
    {
      path: '/',
      label: 'Home',
      icon: (active) => <Home size={28} stroke-width={active ? 2.5 : 1.5} />,
    },
    {
      path: '/channels',
      label: 'Search',
      icon: (active) => <Search size={28} stroke-width={active ? 2.5 : 1.5} />,
    },
    {
      path: '/bookmarks',
      label: 'Bookmarks',
      icon: (active) => <Bookmark size={28} stroke-width={active ? 2.5 : 1.5} fill={active ? 'currentColor' : 'none'} />,
    },
    {
      path: '/settings',
      label: 'Profile',
      icon: (active) => (
        <span class="relative">
          <User size={28} stroke-width={active ? 2.5 : 1.5} />
          <UpdateBadge />
        </span>
      ),
    },
  ]

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <div class="h-screen flex" style={{ background: 'var(--color-bg)' }}>
      {/* Desktop Sidebar - Threads style icon navigation */}
      <aside class="hidden lg:flex flex-col w-[76px] h-screen sticky top-0 border-r border-[var(--nav-border)]">
        {/* Logo */}
        <div class="flex items-center justify-center h-20">
          <A href="/" class="hover:scale-105 transition-transform flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-[#007aff] to-[#5856d6]">
            <MessageCircle size={22} class="text-white" fill="white" />
          </A>
        </div>

        {/* Navigation */}
        <nav class="flex-1 flex flex-col items-center justify-center gap-2">
          {navItems.map((item) => {
            const active = () => isActive(item.path)

            // Home button: always <button> to avoid router click interception
            if (item.path === '/') {
              return (
                <button
                  type="button"
                  class={`threads-nav-item ${active() ? 'threads-nav-item-active' : ''}`}
                  title={item.label}
                  onClick={handleHomeTap}
                >
                  {item.icon(active())}
                </button>
              )
            }

            return (
              <A
                href={item.path}
                class={`threads-nav-item ${active() ? 'threads-nav-item-active' : ''}`}
                title={item.label}
                onClick={handleNavClick}
              >
                {item.icon(active())}
              </A>
            )
          })}
        </nav>

        {/* Bottom spacer */}
        <div class="pb-8" />
      </aside>

      {/* Main content area */}
      <main ref={mainRef} class="flex-1 h-screen overflow-y-auto custom-scrollbar main-scroll-container">
        {/* Centered content - wider feed like Threads */}
        <div class="max-w-2xl mx-auto w-full min-h-full lg:border-x border-[var(--nav-border)]">
          <PageTransition>
            {props.children}
          </PageTransition>
        </div>
      </main>

      {/* Mobile Bottom Navigation - hidden on desktop */}
      <div class="lg:hidden fixed bottom-4 left-0 right-0 z-50 flex items-center justify-between px-4 max-w-md mx-auto safe-bottom nav-container">
        {/* Left: User avatar */}
        <A href="/settings" class="floating-circle relative" onClick={handleNavClick}>
          <UserAvatar
            userId={authStore.user?.id ?? 0}
            name={authStore.user?.displayName ?? 'User'}
            size="md"
          />
          <UpdateBadge />
        </A>

        {/* Center: Nav items (Home, Bookmarks) */}
        <nav class="floating-pill">
          <button
            type="button"
            class={`nav-item ${isActive('/') ? 'nav-item-active' : ''}`}
            onClick={handleHomeTap}
          >
            <Home size={28} stroke-width={isActive('/') ? 2.5 : 1.5} />
          </button>
          <A
            href="/bookmarks"
            class={`nav-item ${isActive('/bookmarks') ? 'nav-item-active' : ''}`}
            onClick={handleNavClick}
          >
            <Bookmark size={28} stroke-width={isActive('/bookmarks') ? 2.5 : 1.5} fill={isActive('/bookmarks') ? 'currentColor' : 'none'} />
          </A>
        </nav>

        {/* Right: Search */}
        <A href="/channels" class="floating-circle" onClick={handleNavClick}>
          <Search size={24} stroke-width={1.5} />
        </A>
      </div>
    </div>
  )
}
