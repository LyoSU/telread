import { Router, Route, Navigate } from '@solidjs/router'
import { QueryClientProvider } from '@tanstack/solid-query'
import { Show, onMount, onCleanup, createEffect, on, ErrorBoundary, type ParentProps } from 'solid-js'
import { queryClient } from '@/lib/query'
import { authStore, clearPosts } from '@/lib/store'
import {
  getTelegramClient,
  setClientReady,
  startUpdatesListener,
  stopUpdatesListener,
  isUpdatesListenerActive,
  clearMediaCache,
} from '@/lib/telegram'
import { validateConfig } from '@/config/telegram'
import { MainLayout } from '@/layouts'
import { FullPageError, UpdatePrompt } from '@/components/ui'
import { MessageCircle } from 'lucide-solid'

import {
  Home,
  Channel,
  Channels,
  Post,
  Bookmarks,
  Settings,
  Login,
} from '@/pages'

/**
 * Protected route wrapper - redirects to login if not authenticated
 *
 * Shows MainLayout immediately for returning users (maybeAuthenticated).
 * Timeline handles its own loading state with skeletons.
 */
function ProtectedRoute(props: ParentProps) {
  // Redirect only after auth check completes and confirms not authenticated
  const shouldRedirect = () => !authStore.isLoading && !authStore.isAuthenticated

  // Show content immediately if user might be authenticated (has previous session)
  // Otherwise show loading screen for first-time users
  const shouldShowContent = () => authStore.maybeAuthenticated || !authStore.isLoading

  return (
    <Show
      when={shouldShowContent()}
      fallback={
        <div class="min-h-screen flex flex-col items-center justify-center bg-[var(--bg-primary)]">
          <div class="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#007aff] to-[#5856d6] flex items-center justify-center mb-6 animate-pulse">
            <MessageCircle size={44} class="text-white" fill="white" />
          </div>
          <h1 class="text-2xl font-semibold text-primary mb-8" style="letter-spacing: -0.5px;">TelRead</h1>
          <div class="w-[120px] h-[3px] rounded-full overflow-hidden" style="background: linear-gradient(90deg, transparent 0%, var(--accent) 50%, transparent 100%); background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite;" />
          <style>{`@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }`}</style>
        </div>
      }
    >
      <Show when={!shouldRedirect()} fallback={<Navigate href="/login" />}>
        <MainLayout>{props.children}</MainLayout>
      </Show>
    </Show>
  )
}

// Stable route components - defined outside App to prevent recreation
function HomePage() {
  return (
    <ProtectedRoute>
      <Home />
    </ProtectedRoute>
  )
}

function ChannelsPage() {
  return (
    <ProtectedRoute>
      <Channels />
    </ProtectedRoute>
  )
}

function ChannelPage() {
  return (
    <ProtectedRoute>
      <Channel />
    </ProtectedRoute>
  )
}

function ChannelByUsernamePage() {
  return (
    <ProtectedRoute>
      <Channel />
    </ProtectedRoute>
  )
}

function PostPage() {
  return (
    <ProtectedRoute>
      <Post />
    </ProtectedRoute>
  )
}

function PostByUsernamePage() {
  return (
    <ProtectedRoute>
      <Post />
    </ProtectedRoute>
  )
}

function BookmarksPage() {
  return (
    <ProtectedRoute>
      <Bookmarks />
    </ProtectedRoute>
  )
}

function SettingsPage() {
  return (
    <ProtectedRoute>
      <Settings />
    </ProtectedRoute>
  )
}

function NotFound() {
  return <Navigate href="/" />
}

/**
 * Main App component
 */
export function App() {
  onMount(async () => {
    if (!validateConfig()) {
      authStore.setIsLoading(false)
      return
    }

    try {
      const client = getTelegramClient()
      await client.connect()

      const user = await client.getMe().catch(() => null)

      if (user) {
        authStore.setUser(user)
        // Mark client as ready for API calls (media downloads, etc.)
        setClientReady(true)

        // IMPORTANT: Register handlers BEFORE starting updates loop
        // This ensures we don't miss any updates that arrive immediately
        startUpdatesListener()

        client.startUpdatesLoop()
          .then(() => {
            if (import.meta.env.DEV) {
              console.log('[App] Updates loop started')
            }
          })
          .catch((error) => {
            console.error('[App] Failed to start updates loop:', error)
          })
      }
    } catch (error) {
      console.error('Auth check failed:', error)
    } finally {
      authStore.setIsLoading(false)
    }
  })

  // Start/stop updates when auth state changes
  // This handles login from Login page and logout scenarios
  // defer: true - don't run on initial value, only on changes
  createEffect(
    on(
      () => authStore.isAuthenticated,
      (isAuth, prevAuth) => {
        if (isAuth) {
          // Only start if not already active (might be started in onMount)
          if (!isUpdatesListenerActive()) {
            startUpdatesListener()
          }
        } else if (prevAuth === true) {
          // Only cleanup if was previously authenticated (actual logout)
          // Don't cleanup on initial load when auth state is being restored
          stopUpdatesListener()
          clearPosts()
          clearMediaCache()
          queryClient.clear()
        }
      },
      { defer: true }
    )
  )

  onCleanup(() => {
    stopUpdatesListener()
  })

  return (
    <>
      <UpdatePrompt />
      <ErrorBoundary
        fallback={(err) => {
        console.error('[App] Error caught by boundary:', err)
        // On cleanNode errors during navigation, just redirect to home
        // Check for various manifestations of this SolidJS cleanup error
        // SolidJS cleanNode errors during navigation - safe to ignore
        const isCleanNodeError =
          err?.message?.includes("reading '24'") ||
          err?.stack?.includes('cleanNode')

        if (isCleanNodeError) {
          // Redirect immediately - no flash
          window.location.replace(import.meta.env.BASE_URL)
          // Return minimal element to prevent further rendering
          return <div style={{ display: 'none' }} />
        }
        // For other errors, show beautiful error state
        return (
          <FullPageError
            title="Something went wrong"
            description="We're sorry, but something unexpected happened. Please try again or return to the home page."
            onRetry={() => window.location.reload()}
            onGoHome={() => window.location.replace(import.meta.env.BASE_URL)}
          />
        )
      }}
    >
      <QueryClientProvider client={queryClient}>
        <Router base={import.meta.env.BASE_URL.slice(0, -1) || undefined}>
          <Route path="/login" component={Login} />
          <Route path="/" component={HomePage} />
          <Route path="/channels" component={ChannelsPage} />
          <Route path="/channel/:id" component={ChannelPage} />
          <Route path="/c/:username/:messageId" component={PostByUsernamePage} />
          <Route path="/c/:username" component={ChannelByUsernamePage} />
          <Route path="/post/:channelId/:messageId" component={PostPage} />
          <Route path="/bookmarks" component={BookmarksPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="*" component={NotFound} />
        </Router>
      </QueryClientProvider>
      </ErrorBoundary>
    </>
  )
}

export default App
