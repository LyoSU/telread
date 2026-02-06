import { Show, Switch, Match } from 'solid-js'
import { Play, RefreshCw } from 'lucide-solid'

type DownloadState = 'loading' | 'error' | 'ready'

interface DownloadOverlayProps {
  /** Current download state */
  state: DownloadState
  /** Size variant — 'sm' for galleries, 'md' for inline players */
  size?: 'sm' | 'md'
  /** Circular clipping for video notes */
  round?: boolean
  /** Formatted file size shown during loading (e.g., "12.5 MB") */
  fileSize?: string
  /** Called when user taps retry on error */
  onRetry?: () => void
}

/**
 * Centralized download state overlay for media containers
 *
 * Renders one of three states over a media thumbnail:
 * - loading: spinning ring + optional file size badge
 * - error:   retry icon (tappable)
 * - ready:   play button
 *
 * Place inside a `position: relative` container.
 * Parent controls visibility (e.g., hide while video is playing).
 */
export function DownloadOverlay(props: DownloadOverlayProps) {
  const sm = () => props.size === 'sm'
  const shape = () => props.round ? 'rounded-full' : ''

  return (
    <Switch>
      {/* Error — tap to retry */}
      <Match when={props.state === 'error'}>
        <div
          class={`absolute inset-0 flex flex-col items-center justify-center bg-black/30 ${shape()}`}
          onClick={(e) => { e.stopPropagation(); props.onRetry?.() }}
        >
          <div
            class={`${sm() ? 'w-10 h-10' : 'w-14 h-14'} rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center cursor-pointer active:scale-95 transition-transform`}
          >
            <RefreshCw size={sm() ? 18 : 22} class="text-white" />
          </div>
        </div>
      </Match>

      {/* Downloading */}
      <Match when={props.state === 'loading'}>
        <div class={`absolute inset-0 flex flex-col items-center justify-center bg-black/30 pointer-events-none ${shape()}`}>
          <div
            class={`${sm() ? 'w-10 h-10' : 'w-14 h-14'} rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center`}
          >
            <div
              class={`${sm() ? 'w-6 h-6 border-2' : 'w-8 h-8 border-[2.5px]'} rounded-full border-white/30 border-t-white animate-spin`}
            />
          </div>
          <Show when={props.fileSize}>
            <span class="mt-2 px-2 py-0.5 rounded-full bg-black/40 text-[11px] text-white/80 font-medium backdrop-blur-sm">
              {props.fileSize}
            </span>
          </Show>
        </div>
      </Match>

      {/* Ready — play icon */}
      <Match when={props.state === 'ready'}>
        <div class={`absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none ${shape()}`}>
          <div
            class={`${sm() ? 'w-10 h-10' : 'w-14 h-14'} rounded-full bg-white/90 flex items-center justify-center shadow-lg`}
          >
            <Play size={sm() ? 20 : 28} class="text-gray-900 ml-0.5" fill="currentColor" />
          </div>
        </div>
      </Match>
    </Switch>
  )
}
