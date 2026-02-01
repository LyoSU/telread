import type { JSX, ParentProps } from 'solid-js'
import { GlassButton } from './GlassButton'
import { AlertTriangle, Inbox, Frown, WifiOff, Lock, AlertCircle, RefreshCw, Home } from 'lucide-solid'

type ErrorVariant = 'error' | 'empty' | 'not-found' | 'network' | 'auth' | 'fatal'

interface ErrorStateProps extends ParentProps {
  variant?: ErrorVariant
  title?: string
  description?: string
  icon?: JSX.Element
  action?: {
    label: string
    onClick: () => void
  }
  secondaryAction?: {
    label: string
    onClick: () => void
  }
  class?: string
  compact?: boolean
}

/**
 * Default configurations for each error variant
 */
const variantConfig: Record<
  ErrorVariant,
  { title: string; description: string; icon: () => JSX.Element; color: string }
> = {
  error: {
    title: 'Something went wrong',
    description: "We couldn't complete your request. Please try again.",
    color: 'var(--danger)',
    icon: () => <AlertTriangle size={32} />,
  },
  empty: {
    title: 'Nothing here yet',
    description: 'This section is empty.',
    color: 'var(--color-text-tertiary)',
    icon: () => <Inbox size={32} />,
  },
  'not-found': {
    title: 'Not found',
    description: "We couldn't find what you're looking for.",
    color: 'var(--warning)',
    icon: () => <Frown size={32} />,
  },
  network: {
    title: 'Connection problem',
    description: 'Please check your internet connection and try again.',
    color: 'var(--warning)',
    icon: () => <WifiOff size={32} />,
  },
  auth: {
    title: 'Session expired',
    description: 'Please sign in again to continue.',
    color: 'var(--accent)',
    icon: () => <Lock size={32} />,
  },
  fatal: {
    title: 'Critical error',
    description: 'An unexpected error occurred. Please restart the app.',
    color: 'var(--danger)',
    icon: () => <AlertCircle size={32} />,
  },
}

/**
 * ErrorState - Beautiful error/empty state component
 *
 * Displays user-friendly error messages with consistent styling.
 * Supports multiple variants for different error types.
 */
export function ErrorState(props: ErrorStateProps) {
  const variant = () => props.variant ?? 'error'
  const config = () => variantConfig[variant()]
  const color = () => config().color

  const title = () => props.title ?? config().title
  const description = () => props.description ?? config().description
  const icon = () => props.icon ?? config().icon()

  if (props.compact) {
    return (
      <div class={`text-center py-4 ${props.class ?? ''}`}>
        <div
          class="inline-flex items-center justify-center w-10 h-10 rounded-full mb-2"
          style={{ background: `color-mix(in srgb, ${color()} 15%, transparent)` }}
        >
          <span style={{ color: color() }}>{icon()}</span>
        </div>
        <p class="text-sm font-medium text-primary mb-0.5">{title()}</p>
        <p class="text-xs text-tertiary mb-3">{description()}</p>
        {props.action && (
          <button
            type="button"
            onClick={props.action.onClick}
            class="text-sm text-accent hover:underline"
          >
            {props.action.label}
          </button>
        )}
        {props.children}
      </div>
    )
  }

  return (
    <div class={`flex flex-col items-center justify-center text-center py-12 px-6 ${props.class ?? ''}`}>
      {/* Icon with colored background */}
      <div
        class="flex items-center justify-center w-16 h-16 rounded-2xl mb-5"
        style={{ background: `color-mix(in srgb, ${color()} 15%, transparent)` }}
      >
        <span style={{ color: color() }}>{icon()}</span>
      </div>

      {/* Title */}
      <h3 class="text-lg font-semibold text-primary mb-2">
        {title()}
      </h3>

      {/* Description */}
      <p class="text-sm text-secondary max-w-xs mb-6">
        {description()}
      </p>

      {/* Actions */}
      <div class="flex flex-col sm:flex-row items-center gap-3">
        {props.action && (
          <GlassButton
            variant="primary"
            size="md"
            onClick={props.action.onClick}
          >
            {props.action.label}
          </GlassButton>
        )}
        {props.secondaryAction && (
          <GlassButton
            variant="ghost"
            size="md"
            onClick={props.secondaryAction.onClick}
          >
            {props.secondaryAction.label}
          </GlassButton>
        )}
      </div>

      {/* Custom content slot */}
      {props.children}
    </div>
  )
}

/**
 * FullPageError - Full screen error for critical failures
 */
export function FullPageError(props: {
  title?: string
  description?: string
  onRetry?: () => void
  onGoHome?: () => void
}) {
  return (
    <div class="min-h-screen flex flex-col items-center justify-center bg-[var(--bg-primary)] px-6">
      {/* Animated error icon */}
      <div class="relative mb-8">
        <div
          class="absolute inset-0 rounded-3xl animate-pulse"
          style="background: linear-gradient(135deg, rgba(255,59,48,0.2) 0%, rgba(255,149,0,0.2) 100%); filter: blur(20px);"
        />
        <div class="relative flex items-center justify-center w-24 h-24 rounded-3xl bg-gradient-to-br from-[var(--danger)] to-[var(--warning)]">
          <AlertTriangle size={48} class="text-white" />
        </div>
      </div>

      {/* Title */}
      <h1 class="text-2xl font-semibold text-primary mb-3" style="letter-spacing: -0.5px;">
        {props.title ?? 'Something went wrong'}
      </h1>

      {/* Description */}
      <p class="text-secondary text-center max-w-sm mb-8">
        {props.description ?? "We're sorry, but something unexpected happened. Please try again or return to the home page."}
      </p>

      {/* Actions */}
      <div class="flex flex-col sm:flex-row items-center gap-3">
        {props.onRetry && (
          <GlassButton
            variant="primary"
            size="lg"
            onClick={props.onRetry}
          >
            <RefreshCw size={20} />
            Try Again
          </GlassButton>
        )}
        {props.onGoHome && (
          <GlassButton
            variant="ghost"
            size="lg"
            onClick={props.onGoHome}
          >
            <Home size={20} />
            Go Home
          </GlassButton>
        )}
      </div>
    </div>
  )
}

/**
 * InlineError - Small inline error message
 */
export function InlineError(props: {
  message: string
  onRetry?: () => void
  class?: string
}) {
  return (
    <div class={`flex items-center gap-2 text-sm ${props.class ?? ''}`}>
      <AlertCircle size={16} class="flex-shrink-0" style={{ color: 'var(--danger)' }} />
      <span style="color: var(--danger)">{props.message}</span>
      {props.onRetry && (
        <button
          type="button"
          onClick={props.onRetry}
          class="text-accent hover:underline ml-1"
        >
          Retry
        </button>
      )}
    </div>
  )
}
