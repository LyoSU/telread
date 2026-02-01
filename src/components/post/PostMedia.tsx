import { createSignal, Show, Match, Switch, For, onCleanup, onMount, createMemo, createEffect } from 'solid-js'
import { Portal } from 'solid-js/web'
import { Motion } from 'solid-motionone'
import { DEFAULT_ASPECT_RATIO } from '@/config/constants'
import type { MessageMedia } from '@/lib/telegram'
import { useMedia } from '@/lib/query'
import { mediaController } from '@/lib/media'
import { Skeleton } from '@/components/ui'
import { Play, Pause, FileText, Music, MapPin, User, ExternalLink, X, Volume2, VolumeX } from 'lucide-solid'

interface PostMediaProps {
  channelId: number
  messageId: number
  media: MessageMedia
  class?: string
}

/**
 * Renders post media (photos, videos, documents)
 * Uses Intersection Observer for lazy loading - only loads when visible
 * 
 * Uses useMedia hook which handles:
 * - Caching (RAM -> IndexedDB -> API)
 * - Client readiness
 * - Automatic cleanup on unmount
 */
export function PostMedia(props: PostMediaProps) {
  const [isExpanded, setIsExpanded] = createSignal(false)
  const [isVisible, setIsVisible] = createSignal(false)
  
  let observer: IntersectionObserver | undefined

  // Load full resolution image
  const mediaQuery = useMedia(
    () => props.channelId,
    () => props.messageId,
    () => 'large',
    isVisible
  )

  // Memoized aspect ratio calculation
  const aspectRatio = createMemo(() => {
    const width = props.media.width
    const height = props.media.height
    if (width && height && height > 0) {
      return width / height
    }
    return DEFAULT_ASPECT_RATIO
  })

  // Threads-style: fixed height with natural width based on aspect ratio
  const containerStyle = createMemo(() => ({
    height: '240px',
    width: `${240 * aspectRatio()}px`,
    'min-width': '160px',
    'max-width': '100%',
  }))

  // Setup Intersection Observer for lazy loading
  const setupObserver = (el: HTMLDivElement) => {
    observer = new IntersectionObserver(
      (entries) => {
        // Check observer still exists (not cleaned up)
        if (entries[0]?.isIntersecting && observer) {
          observer.disconnect()
          observer = undefined
          setIsVisible(true)
        }
      },
      {
        rootMargin: '400px',
        threshold: 0
      }
    )
    observer.observe(el)
  }

  // Handle keyboard interaction for accessibility
  const handleImageKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setIsExpanded(true)
    }
  }

  // Cleanup observer on unmount
  onCleanup(() => {
    observer?.disconnect()
    observer = undefined
  })

  return (
    <div ref={setupObserver} class={`relative ${props.class ?? ''}`}>
      <Switch>
        {/* Photo - shows inline thumbnail first, then full image */}
        <Match when={props.media.type === 'photo'}>
          <div 
            class="relative rounded-2xl overflow-hidden flex-shrink-0 shadow-sm hover:shadow-md transition-shadow" 
            style={containerStyle()}
          >
            {/* Full image (shows when loaded) */}
            <Show when={mediaQuery.data}>
              {(url) => (
                <img
                  src={url()}
                  alt="Post media"
                  class="w-full h-full object-cover cursor-pointer hover:scale-[1.02] transition-transform duration-200 focus:outline-none focus:ring-2 focus:ring-accent"
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsExpanded(true)
                  }}
                  onKeyDown={handleImageKeyDown}
                  tabIndex={0}
                  role="button"
                />
              )}
            </Show>
            {/* Inline thumbnail with blur (shows while full loads) */}
            <Show when={!mediaQuery.data}>
              <Show
                when={props.media.thumb}
                fallback={<div class="absolute inset-0 skeleton" />}
              >
                <img
                  src={props.media.thumb}
                  alt=""
                  class="absolute inset-0 w-full h-full object-cover blur-sm scale-105"
                />
              </Show>
            </Show>
          </div>
        </Match>

        {/* Video - Inline player */}
        <Match when={props.media.type === 'video'}>
          <InlineVideoPlayer
            channelId={props.channelId}
            messageId={props.messageId}
            media={props.media}
            containerStyle={containerStyle()}
            isVisible={isVisible}
            onExpand={() => setIsExpanded(true)}
          />
        </Match>

        {/* Video Note (кружок) - Circular player */}
        <Match when={props.media.type === 'video_note'}>
          <InlineVideoNote
            channelId={props.channelId}
            messageId={props.messageId}
            media={props.media}
            isVisible={isVisible}
          />
        </Match>

        {/* GIF/Animation - plays inline automatically */}
        <Match when={props.media.type === 'animation'}>
          <GifPlayer
            channelId={props.channelId}
            messageId={props.messageId}
            media={props.media}
            containerStyle={containerStyle()}
            isVisible={isVisible}
          />
        </Match>

        {/* Document */}
        <Match when={props.media.type === 'document'}>
          <div class="glass rounded-xl p-4 flex items-center gap-4">
            <div class="w-12 h-12 rounded-lg bg-[var(--accent)]/15 flex items-center justify-center">
              <FileText size={24} class="text-accent" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-primary truncate">
                {props.media.fileName || 'Document'}
              </p>
              <p class="text-xs text-tertiary">
                {props.media.size ? formatFileSize(props.media.size) : 'Unknown size'}
              </p>
            </div>
          </div>
        </Match>

        {/* Sticker */}
        <Match when={props.media.type === 'sticker'}>
          <StickerPlayer
            channelId={props.channelId}
            messageId={props.messageId}
            media={props.media}
            isVisible={isVisible}
          />
        </Match>

        {/* Audio - Inline player */}
        <Match when={props.media.type === 'audio'}>
          <InlineAudioPlayer
            channelId={props.channelId}
            messageId={props.messageId}
            media={props.media}
            isVisible={isVisible}
          />
        </Match>

        {/* Voice - Inline player with waveform */}
        <Match when={props.media.type === 'voice'}>
          <InlineVoicePlayer
            channelId={props.channelId}
            messageId={props.messageId}
            media={props.media}
            isVisible={isVisible}
          />
        </Match>

        {/* Poll */}
        <Match when={props.media.type === 'poll'}>
          <div class="glass rounded-xl p-4">
            <div class="flex items-center gap-2 mb-3">
              <Show when={props.media.pollQuiz}>
                <span class="text-xs px-2 py-0.5 rounded bg-[var(--accent)]/15 text-accent font-medium">Quiz</span>
              </Show>
              <Show when={props.media.pollClosed}>
                <span class="text-xs px-2 py-0.5 rounded bg-tertiary/20 text-tertiary font-medium">Closed</span>
              </Show>
            </div>
            <p class="text-sm font-medium text-primary mb-3">{props.media.pollQuestion}</p>
            <div class="space-y-2">
              <For each={props.media.pollAnswers}>
                {(answer) => {
                  const percentage = () => props.media.pollVoters && props.media.pollVoters > 0
                    ? Math.round((answer.voters / props.media.pollVoters!) * 100)
                    : 0
                  return (
                    <div class="relative">
                      <div
                        class={`absolute inset-0 rounded-lg transition-all ${
                          answer.correct ? 'bg-green-500/20' : answer.chosen ? 'bg-[var(--accent)]/20' : 'bg-[var(--accent)]/10'
                        }`}
                        style={{ width: `${percentage()}%` }}
                      />
                      <div class="relative flex items-center justify-between p-2 rounded-lg">
                        <span class="text-sm text-primary">{answer.text}</span>
                        <span class="text-xs text-tertiary font-medium">{percentage()}%</span>
                      </div>
                    </div>
                  )
                }}
              </For>
            </div>
            <Show when={props.media.pollVoters !== undefined}>
              <p class="text-xs text-tertiary mt-3">
                {props.media.pollVoters} {props.media.pollVoters === 1 ? 'vote' : 'votes'}
              </p>
            </Show>
          </div>
        </Match>

        {/* Location */}
        <Match when={props.media.type === 'location'}>
          <a
            href={`https://maps.google.com/?q=${props.media.latitude},${props.media.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            class="glass rounded-xl p-4 flex items-center gap-4 hover:bg-[var(--bg-secondary)] transition-colors"
          >
            <div class="w-12 h-12 rounded-lg bg-green-500/15 flex items-center justify-center flex-shrink-0">
              <MapPin size={24} class="text-green-500" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-primary">Location</p>
              <p class="text-xs text-tertiary truncate">
                {props.media.latitude?.toFixed(6)}, {props.media.longitude?.toFixed(6)}
              </p>
              <Show when={props.media.period}>
                <p class="text-xs text-green-500 mt-1">Live location</p>
              </Show>
            </div>
            <ExternalLink size={20} class="text-tertiary flex-shrink-0" />
          </a>
        </Match>

        {/* Venue */}
        <Match when={props.media.type === 'venue'}>
          <a
            href={`https://maps.google.com/?q=${props.media.latitude},${props.media.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            class="glass rounded-xl p-4 flex items-center gap-4 hover:bg-[var(--bg-secondary)] transition-colors"
          >
            <div class="w-12 h-12 rounded-lg bg-orange-500/15 flex items-center justify-center flex-shrink-0">
              <MapPin size={24} class="text-orange-500" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-primary truncate">{props.media.venueTitle}</p>
              <p class="text-xs text-tertiary truncate">{props.media.address}</p>
            </div>
            <ExternalLink size={20} class="text-tertiary flex-shrink-0" />
          </a>
        </Match>

        {/* Contact */}
        <Match when={props.media.type === 'contact'}>
          <div class="glass rounded-xl p-4 flex items-center gap-4">
            <div class="w-12 h-12 rounded-full bg-blue-500/15 flex items-center justify-center flex-shrink-0">
              <User size={24} class="text-blue-500" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-primary truncate">
                {props.media.firstName} {props.media.lastName}
              </p>
              <a
                href={`tel:${props.media.phoneNumber}`}
                class="text-xs text-accent hover:underline"
              >
                {props.media.phoneNumber}
              </a>
            </div>
          </div>
        </Match>

        {/* Dice */}
        <Match when={props.media.type === 'dice'}>
          <div class="flex items-center justify-center p-4">
            <div class="text-6xl" title={`Value: ${props.media.value}`}>
              {props.media.emoji}
            </div>
          </div>
        </Match>

        {/* Webpage preview - compact Twitter style */}
        <Match when={props.media.type === 'webpage'}>
          <a
            href={props.media.webpageUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="block rounded-xl border border-[var(--text-tertiary)]/20 overflow-hidden hover:border-[var(--text-tertiary)]/40 transition-colors"
          >
            <Show when={props.media.webpagePhoto}>
              <div class="relative w-full aspect-[2/1] bg-[var(--bg-secondary)]">
                <Show when={mediaQuery.data}>
                  {(url) => <img src={url()} alt="" class="w-full h-full object-cover" />}
                </Show>
                <Show when={!mediaQuery.data}>
                  <Show when={props.media.thumb} fallback={<div class="absolute inset-0 skeleton" />}>
                    <img src={props.media.thumb} alt="" class="absolute inset-0 w-full h-full object-cover blur-sm scale-105" />
                  </Show>
                </Show>
              </div>
            </Show>
            <div class="px-3 py-2">
              <p class="text-[13px] text-secondary truncate leading-4">
                {props.media.webpageTitle || (() => {
                  try { return new URL(props.media.webpageUrl ?? '').hostname.replace('www.', '') }
                  catch { return props.media.webpageSiteName ?? '' }
                })()}
              </p>
              <Show when={props.media.webpageTitle && props.media.webpageDescription}>
                <p class="text-[13px] text-tertiary leading-4 truncate">{props.media.webpageDescription}</p>
              </Show>
            </div>
          </a>
        </Match>
      </Switch>

      {/* Fullscreen modal - rendered in Portal to avoid event propagation issues */}
      <Show when={isExpanded()}>
        <Portal>
          <MediaModal
            channelId={props.channelId}
            messageId={props.messageId}
            media={props.media}
            onClose={() => setIsExpanded(false)}
          />
        </Portal>
      </Show>
    </div>
  )
}

/**
 * Inline Voice Player with interactive waveform
 * 
 * Best practices:
 * - NO autoplay (only on tap)
 * - Auto-pause when scrolled out of view
 * - Global controller (one audio at a time)
 * - Media Session for lock screen controls
 */
function InlineVoicePlayer(props: {
  channelId: number
  messageId: number
  media: MessageMedia
  isVisible: () => boolean
}) {
  const mediaId = `voice-${props.channelId}-${props.messageId}`
  
  const [isPlaying, setIsPlaying] = createSignal(false)
  const [currentTime, setCurrentTime] = createSignal(0)
  const [duration, setDuration] = createSignal(props.media.duration ?? 0)
  
  let audioRef: HTMLAudioElement | undefined
  let visibilityObserver: IntersectionObserver | undefined
  let unregister: (() => void) | undefined

  // Pause when scrolled out of view
  const setupContainer = (el: HTMLDivElement) => {
    visibilityObserver = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting && isPlaying()) {
          mediaController.pause(mediaId)
        }
      },
      { threshold: 0.2 }
    )
    visibilityObserver.observe(el)
  }

  // Load full audio file
  const audioQuery = useMedia(
    () => props.channelId,
    () => props.messageId,
    () => undefined,
    props.isVisible
  )

  // Setup audio element
  const setupAudio = (el: HTMLAudioElement) => {
    audioRef = el
    
    unregister = mediaController.register(mediaId, 'voice', el, {
      onPause: () => setIsPlaying(false),
    }, {
      title: 'Voice message',
    })
  }

  const progress = () => duration() > 0 ? (currentTime() / duration()) * 100 : 0
  const waveform = () => props.media.waveform ?? []
  const barCount = 40

  // Normalize waveform to barCount bars
  const normalizedWaveform = createMemo(() => {
    const w = waveform()
    if (w.length === 0) return Array(barCount).fill(4)
    
    const step = w.length / barCount
    const result: number[] = []
    for (let i = 0; i < barCount; i++) {
      const idx = Math.floor(i * step)
      result.push(w[idx] ?? 4)
    }
    return result
  })

  const handlePlayPause = (e: MouseEvent) => {
    e.stopPropagation()
    if (!audioRef) return
    
    if (isPlaying()) {
      mediaController.pause(mediaId)
    } else {
      mediaController.play(mediaId)
    }
  }

  const handleWaveformClick = (e: MouseEvent) => {
    e.stopPropagation()
    if (!audioRef || duration() === 0) return
    
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const percent = x / rect.width
    audioRef.currentTime = percent * duration()
  }

  const displayTime = () => {
    if (isPlaying() || currentTime() > 0) {
      return formatDuration(currentTime())
    }
    return formatDuration(duration())
  }

  onCleanup(() => {
    visibilityObserver?.disconnect()
    unregister?.()
  })

  return (
    <div ref={setupContainer} class="glass rounded-xl p-3 flex items-center gap-3">
      {/* Play/Pause button */}
      <button
        type="button"
        aria-label={isPlaying() ? 'Pause' : 'Play voice message'}
        onClick={handlePlayPause}
        disabled={!audioQuery.data}
        class="w-10 h-10 rounded-full bg-[var(--accent)] flex items-center justify-center flex-shrink-0
               hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-accent
               disabled:opacity-50"
      >
        <Show when={isPlaying()} fallback={
          <Play size={20} class="text-white ml-0.5" fill="currentColor" />
        }>
          <Pause size={20} class="text-white" fill="currentColor" />
        </Show>
      </button>

      {/* Interactive Waveform */}
      <div 
        class="flex-1 flex items-center gap-0.5 h-8 cursor-pointer"
        onClick={handleWaveformClick}
      >
        <For each={normalizedWaveform()}>
          {(value, index) => {
            const barProgress = () => (index() / barCount) * 100
            const isPlayed = () => barProgress() < progress()
            return (
              <div
                class={`w-1 rounded-full transition-colors ${
                  isPlayed() ? 'bg-[var(--accent)]' : 'bg-[var(--accent)]/30'
                }`}
                style={{ height: `${Math.max(12, (value / 31) * 100)}%` }}
              />
            )
          }}
        </For>
      </div>

      {/* Duration / Current time */}
      <span class="text-xs text-tertiary flex-shrink-0 min-w-[36px] text-right">
        {displayTime()}
      </span>

      {/* Hidden audio element */}
      <Show when={audioQuery.data}>
        {(url) => (
          <audio
            ref={setupAudio}
            src={url()}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => {
              setIsPlaying(false)
              setCurrentTime(0)
            }}
            onTimeUpdate={() => setCurrentTime(audioRef?.currentTime ?? 0)}
            onLoadedMetadata={() => setDuration(audioRef?.duration ?? props.media.duration ?? 0)}
            preload="metadata"
          />
        )}
      </Show>
    </div>
  )
}

/**
 * Inline Video Note (кружок) - Circular video player like Telegram
 * 
 * Best practices:
 * - Muted autoplay when visible
 * - Loop playback
 * - Tap to pause/unmute
 * - Circular progress ring
 */
function InlineVideoNote(props: {
  channelId: number
  messageId: number
  media: MessageMedia
  isVisible: () => boolean
}) {
  const mediaId = `videonote-${props.channelId}-${props.messageId}`
  
  const [isPlaying, setIsPlaying] = createSignal(false)
  const [isMuted, setIsMuted] = createSignal(true)
  const [currentTime, setCurrentTime] = createSignal(0)
  const [duration, setDuration] = createSignal(props.media.duration ?? 0)
  const [isLoaded, setIsLoaded] = createSignal(false)
  const [isInViewport, setIsInViewport] = createSignal(false)
  const [userPaused, setUserPaused] = createSignal(false)
  
  let videoRef: HTMLVideoElement | undefined
  let visibilityObserver: IntersectionObserver | undefined
  let unregister: (() => void) | undefined

  // Reactive autoplay - triggers when visibility OR loaded state changes
  createEffect(() => {
    const visible = isInViewport()
    const loaded = isLoaded()
    
    if (visible && loaded && videoRef && !userPaused()) {
      videoRef.muted = true
      setIsMuted(true)
      mediaController.play(mediaId)
    } else if (!visible) {
      mediaController.pause(mediaId)
      setUserPaused(false) // Reset when leaving viewport
    }
  })

  // Track visibility
  const setupContainer = (el: HTMLDivElement) => {
    visibilityObserver = new IntersectionObserver(
      (entries) => setIsInViewport(entries[0]?.isIntersecting ?? false),
      { threshold: 0.5 }
    )
    visibilityObserver.observe(el)
  }

  // Load full video file
  const videoQuery = useMedia(
    () => props.channelId,
    () => props.messageId,
    () => undefined,
    props.isVisible
  )

  // Setup video element
  const setupVideo = (el: HTMLVideoElement) => {
    videoRef = el
    el.muted = true
    el.loop = true
    
    unregister = mediaController.register(mediaId, 'video_note', el, {
      onPause: () => setIsPlaying(false),
    })
  }

  const progress = () => duration() > 0 ? (currentTime() / duration()) * 100 : 0
  const size = 200
  const circumference = 2 * Math.PI * 96
  const strokeDashoffset = () => circumference - (progress() / 100) * circumference

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation()
    if (!videoRef) return
    
    if (isPlaying()) {
      // If playing, toggle mute first, then pause on second tap
      if (isMuted()) {
        const nowUnmuted = mediaController.toggleMute(mediaId)
        setIsMuted(!nowUnmuted)
      } else {
        mediaController.pause(mediaId)
        setUserPaused(true) // User manually paused
      }
    } else {
      setUserPaused(false)
      mediaController.play(mediaId)
    }
  }

  onCleanup(() => {
    visibilityObserver?.disconnect()
    unregister?.()
  })

  return (
    <div 
      ref={setupContainer}
      class="relative cursor-pointer group"
      style={{ width: `${size}px`, height: `${size}px` }}
      onClick={handleClick}
    >
      {/* Circular video container */}
      <div class="w-full h-full rounded-full overflow-hidden bg-black/20">
        <Show when={videoQuery.data}>
          {(url) => (
            <video
              ref={setupVideo}
              src={url()}
              class="w-full h-full object-cover"
              loop
              muted
              playsinline
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onTimeUpdate={() => setCurrentTime(videoRef?.currentTime ?? 0)}
              onLoadedMetadata={() => {
                setDuration(videoRef?.duration ?? props.media.duration ?? 0)
                setIsLoaded(true)
              }}
              onVolumeChange={() => setIsMuted(videoRef?.muted ?? true)}
            />
          )}
        </Show>
        <Show when={!videoQuery.data}>
          <Show
            when={props.media.thumb}
            fallback={<div class="w-full h-full skeleton rounded-full" />}
          >
            <img src={props.media.thumb} alt="" class="w-full h-full object-cover blur-sm scale-105" />
          </Show>
        </Show>
      </div>

      {/* Circular progress ring */}
      <svg 
        class="absolute inset-0 -rotate-90 pointer-events-none"
        width={size} 
        height={size}
      >
        <circle cx={size / 2} cy={size / 2} r={96} fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="3" />
        <circle
          cx={size / 2} cy={size / 2} r={96} fill="none"
          stroke="var(--accent)" stroke-width="3" stroke-linecap="round"
          stroke-dasharray={String(circumference)} stroke-dashoffset={strokeDashoffset()}
          class="transition-all duration-100"
        />
      </svg>

      {/* Play overlay (when not playing) */}
      <Show when={!isPlaying()}>
        <div class="absolute inset-0 flex items-center justify-center bg-black/30 rounded-full group-hover:bg-black/40 transition-colors">
          <div class="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
            <Play size={24} class="text-gray-900 ml-0.5" fill="currentColor" />
          </div>
        </div>
      </Show>

      {/* Mute indicator (when playing and muted) */}
      <Show when={isPlaying() && isMuted()}>
        <div class="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white backdrop-blur-sm">
          <VolumeX size={14} />
        </div>
      </Show>

      {/* Duration badge */}
      <div class="absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-black/60 text-white text-xs font-medium backdrop-blur-sm">
        {isPlaying() ? formatDuration(currentTime()) : formatDuration(duration())}
      </div>
    </div>
  )
}

/**
 * Inline Audio Player with progress bar
 * 
 * Best practices:
 * - NO autoplay (only on tap)
 * - Auto-pause when scrolled out of view
 * - Global controller (one audio at a time)
 * - Media Session for lock screen controls
 */
function InlineAudioPlayer(props: {
  channelId: number
  messageId: number
  media: MessageMedia
  isVisible: () => boolean
}) {
  const mediaId = `audio-${props.channelId}-${props.messageId}`
  
  const [isPlaying, setIsPlaying] = createSignal(false)
  const [currentTime, setCurrentTime] = createSignal(0)
  const [duration, setDuration] = createSignal(props.media.duration ?? 0)
  
  let audioRef: HTMLAudioElement | undefined
  let visibilityObserver: IntersectionObserver | undefined
  let unregister: (() => void) | undefined

  // Pause when scrolled out of view
  const setupContainer = (el: HTMLDivElement) => {
    visibilityObserver = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting && isPlaying()) {
          mediaController.pause(mediaId)
        }
      },
      { threshold: 0.2 }
    )
    visibilityObserver.observe(el)
  }

  // Load full audio file
  const audioQuery = useMedia(
    () => props.channelId,
    () => props.messageId,
    () => undefined,
    props.isVisible
  )

  // Setup audio element
  const setupAudio = (el: HTMLAudioElement) => {
    audioRef = el
    
    unregister = mediaController.register(mediaId, 'audio', el, {
      onPause: () => setIsPlaying(false),
    }, {
      title: props.media.title || props.media.fileName || 'Audio',
      artist: props.media.performer || 'Unknown artist',
    })
  }

  const progress = () => duration() > 0 ? (currentTime() / duration()) * 100 : 0

  const handlePlayPause = (e: MouseEvent) => {
    e.stopPropagation()
    if (!audioRef) return
    
    if (isPlaying()) {
      mediaController.pause(mediaId)
    } else {
      mediaController.play(mediaId)
    }
  }

  const handleProgressClick = (e: MouseEvent) => {
    e.stopPropagation()
    if (!audioRef || duration() === 0) return
    
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const percent = x / rect.width
    audioRef.currentTime = percent * duration()
  }

  onCleanup(() => {
    visibilityObserver?.disconnect()
    unregister?.()
  })

  return (
    <div ref={setupContainer} class="glass rounded-xl p-4">
      <div class="flex items-center gap-4">
        {/* Album art / Icon */}
        <div class="w-12 h-12 rounded-lg bg-[var(--accent)]/15 flex items-center justify-center flex-shrink-0">
          <Music size={24} class="text-accent" />
        </div>

        {/* Info */}
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-primary truncate">
            {props.media.title || props.media.fileName || 'Audio'}
          </p>
          <p class="text-xs text-tertiary truncate">
            {props.media.performer || 'Unknown artist'}
          </p>
        </div>

        {/* Play/Pause button */}
        <button
          type="button"
          aria-label={isPlaying() ? 'Pause' : 'Play audio'}
          onClick={handlePlayPause}
          disabled={!audioQuery.data}
          class="w-10 h-10 rounded-full bg-[var(--accent)] flex items-center justify-center flex-shrink-0
                 hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-accent
                 disabled:opacity-50"
        >
          <Show when={isPlaying()} fallback={
            <Play size={20} class="text-white ml-0.5" fill="currentColor" />
          }>
            <Pause size={20} class="text-white" fill="currentColor" />
          </Show>
        </button>
      </div>

      {/* Progress bar */}
      <div class="mt-3 flex items-center gap-2">
        <span class="text-xs text-tertiary min-w-[36px]">
          {formatDuration(currentTime())}
        </span>
        <div 
          class="flex-1 h-1 bg-[var(--accent)]/20 rounded-full cursor-pointer overflow-hidden"
          onClick={handleProgressClick}
        >
          <div 
            class="h-full bg-[var(--accent)] rounded-full transition-all duration-100"
            style={{ width: `${progress()}%` }}
          />
        </div>
        <span class="text-xs text-tertiary min-w-[36px] text-right">
          {formatDuration(duration())}
        </span>
      </div>

      {/* Hidden audio element */}
      <Show when={audioQuery.data}>
        {(url) => (
          <audio
            ref={setupAudio}
            src={url()}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => {
              setIsPlaying(false)
              setCurrentTime(0)
            }}
            onTimeUpdate={() => setCurrentTime(audioRef?.currentTime ?? 0)}
            onLoadedMetadata={() => setDuration(audioRef?.duration ?? props.media.duration ?? 0)}
            preload="metadata"
          />
        )}
      </Show>
    </div>
  )
}

/**
 * Inline Video Player
 * 
 * Best practices (Twitter/Instagram style):
 * - Muted autoplay when visible (>50% in viewport)
 * - Auto-pause when scrolled out of view  
 * - Only one video plays at a time (via mediaController)
 * - Tap video = play/pause
 * - Tap sound icon = mute/unmute
 */
function InlineVideoPlayer(props: {
  channelId: number
  messageId: number
  media: MessageMedia
  containerStyle: Record<string, string>
  isVisible: () => boolean
  onExpand: () => void
}) {
  const mediaId = `video-${props.channelId}-${props.messageId}`
  
  const [isPlaying, setIsPlaying] = createSignal(false)
  const [isMuted, setIsMuted] = createSignal(true)
  const [isLoaded, setIsLoaded] = createSignal(false)
  const [isInViewport, setIsInViewport] = createSignal(false)
  const [userPaused, setUserPaused] = createSignal(false)
  
  let videoRef: HTMLVideoElement | undefined
  let visibilityObserver: IntersectionObserver | undefined
  let unregister: (() => void) | undefined

  // Reactive autoplay - triggers when visibility OR loaded state changes
  createEffect(() => {
    const visible = isInViewport()
    const loaded = isLoaded()
    
    if (visible && loaded && videoRef && !userPaused()) {
      videoRef.muted = true
      setIsMuted(true)
      mediaController.play(mediaId)
    } else if (!visible) {
      mediaController.pause(mediaId)
      setUserPaused(false) // Reset when leaving viewport
    }
  })

  // Track visibility
  const setupContainer = (el: HTMLDivElement) => {
    visibilityObserver = new IntersectionObserver(
      (entries) => setIsInViewport(entries[0]?.isIntersecting ?? false),
      { threshold: 0.5 }
    )
    visibilityObserver.observe(el)
  }

  // Load large thumbnail for video preview
  const thumbQuery = useMedia(
    () => props.channelId,
    () => props.messageId,
    () => 'large',
    props.isVisible
  )

  // Load full video when visible
  const videoQuery = useMedia(
    () => props.channelId,
    () => props.messageId,
    () => undefined,
    props.isVisible
  )

  // Setup video element
  const setupVideo = (el: HTMLVideoElement) => {
    videoRef = el
    el.muted = true
    
    // Register with global controller
    unregister = mediaController.register(mediaId, 'video', el, {
      onPause: () => setIsPlaying(false),
    })
  }

  // Tap on video = open fullscreen (like Telegram)
  const handleVideoClick = (e: MouseEvent) => {
    e.stopPropagation()
    mediaController.pause(mediaId)
    setUserPaused(true)
    props.onExpand()
  }

  // Mute button - quick unmute without opening fullscreen
  const handleMuteClick = (e: MouseEvent) => {
    e.stopPropagation()
    if (!videoRef) return
    
    const nowUnmuted = mediaController.toggleMute(mediaId)
    setIsMuted(!nowUnmuted)
  }

  onCleanup(() => {
    visibilityObserver?.disconnect()
    unregister?.()
  })

  return (
    <div 
      ref={setupContainer}
      class="relative rounded-2xl overflow-hidden flex-shrink-0 shadow-sm hover:shadow-md transition-shadow bg-black cursor-pointer" 
      style={props.containerStyle}
      onClick={handleVideoClick}
    >
      {/* Video element */}
      <Show when={videoQuery.data}>
        {(url) => (
          <video
            ref={setupVideo}
            src={url()}
            class="w-full h-full object-cover"
            playsinline
            muted
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            onLoadedMetadata={() => setIsLoaded(true)}
            onVolumeChange={() => setIsMuted(videoRef?.muted ?? true)}
          />
        )}
      </Show>

      {/* Video thumbnail */}
      <Show when={!videoQuery.data}>
        <Show when={thumbQuery.data} fallback={
          <Show when={props.media.thumb} fallback={<div class="absolute inset-0 skeleton" />}>
            <img src={props.media.thumb} alt="" class="w-full h-full object-cover blur-sm scale-105" />
          </Show>
        }>
          {(url) => <img src={url()} alt="Video thumbnail" class="w-full h-full object-cover" />}
        </Show>
        {/* Loading indicator */}
        <Show when={videoQuery.isLoading}>
          <div class="absolute inset-0 flex items-center justify-center bg-black/20">
            <div class="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        </Show>
      </Show>

      {/* Play icon overlay - tap anywhere to open fullscreen */}
      <Show when={!isPlaying()}>
        <div class="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
          <div class="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
            <Play size={28} class="text-gray-900 ml-1" fill="currentColor" />
          </div>
        </div>
      </Show>

      {/* Bottom controls */}
      <div class="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent">
        <div class="flex items-center justify-between">
          {/* Mute/Unmute button */}
          <button
            type="button"
            aria-label={isMuted() ? 'Unmute' : 'Mute'}
            onClick={handleMuteClick}
            class="p-1.5 rounded-lg bg-black/40 text-white/90 hover:text-white backdrop-blur-sm
                   transition-colors focus:outline-none"
          >
            <Show when={isMuted()} fallback={<Volume2 size={18} />}>
              <VolumeX size={18} />
            </Show>
          </button>
          
          {/* Duration badge */}
          <Show when={props.media.duration !== undefined}>
            <div class="px-2 py-1 rounded-lg bg-black/40 text-white text-xs font-medium backdrop-blur-sm">
              {formatDuration(props.media.duration!)}
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}

/**
 * Sticker player - supports static, animated (Lottie), and video stickers
 */
function StickerPlayer(props: {
  channelId: number
  messageId: number
  media: MessageMedia
  isVisible: () => boolean
}) {
  const mediaQuery = useMedia(
    () => props.channelId,
    () => props.messageId,
    () => undefined,
    props.isVisible
  )

  const stickerType = () => props.media.stickerType ?? 'static'

  return (
    <div class="w-40 h-40 relative">
      <Show when={mediaQuery.data}>
        {(url) => (
          <Switch>
            <Match when={stickerType() === 'static'}>
              <img src={url()} alt={props.media.stickerEmoji || 'Sticker'} class="w-full h-full object-contain drop-shadow-md" />
            </Match>
            <Match when={stickerType() === 'video'}>
              <video src={url()} class="w-full h-full object-contain drop-shadow-md" autoplay muted loop playsinline />
            </Match>
            <Match when={stickerType() === 'animated'}>
              <div class="w-full h-full flex items-center justify-center bg-[var(--accent)]/10 rounded-xl">
                <span class="text-4xl">{props.media.stickerEmoji || '🎭'}</span>
              </div>
            </Match>
          </Switch>
        )}
      </Show>
      <Show when={!mediaQuery.data}>
        <Show when={props.media.thumb} fallback={<Skeleton class="w-full h-full" rounded="lg" />}>
          <img src={props.media.thumb} alt="" class="absolute inset-0 w-full h-full object-contain blur-sm" />
        </Show>
      </Show>
    </div>
  )
}

/**
 * Inline GIF player - auto-plays, shows inline thumb while loading
 */
function GifPlayer(props: {
  channelId: number
  messageId: number
  media: MessageMedia
  containerStyle: Record<string, string>
  isVisible: () => boolean
}) {
  const gifQuery = useMedia(
    () => props.channelId,
    () => props.messageId,
    () => undefined,
    props.isVisible
  )

  return (
    <div 
      class="relative rounded-2xl overflow-hidden flex-shrink-0 shadow-sm hover:shadow-md transition-shadow" 
      style={props.containerStyle}
    >
      <Show when={gifQuery.data}>
        {(url) => (
          <video src={url()} class="w-full h-full object-cover" autoplay muted loop playsinline />
        )}
      </Show>
      <Show when={!gifQuery.data}>
        <Show when={props.media.thumb} fallback={<div class="absolute inset-0 skeleton" />}>
          <img src={props.media.thumb} alt="" class="absolute inset-0 w-full h-full object-cover blur-sm scale-105" />
        </Show>
      </Show>
    </div>
  )
}

/**
 * Fullscreen media modal with video player
 */
function MediaModal(props: {
  channelId: number
  messageId: number
  media: MessageMedia
  onClose: () => void
}) {
  // Load full resolution - query handles cleanup automatically
  const fullQuery = useMedia(
    () => props.channelId,
    () => props.messageId,
    () => undefined
  )

  // Track if closed by back button to avoid double history.back()
  let closedByBackButton = false

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeModal()
    }
  }

  const handlePopState = () => {
    closedByBackButton = true
    props.onClose()
  }

  const closeModal = () => {
    // Remove our history entry before closing
    if (!closedByBackButton) {
      history.back()
    }
    props.onClose()
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    
    // Push fake history entry so back button closes modal
    history.pushState({ modal: 'media' }, '')
    window.addEventListener('popstate', handlePopState)
  })

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('popstate', handlePopState)
    document.body.style.overflow = ''
  })

  const isVideo = () => props.media.type === 'video' || props.media.type === 'video_note'

  return (
    <Motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      class="fixed inset-0 z-[9999] bg-black flex items-center justify-center"
      onClick={closeModal}
    >
      {/* Close button */}
      <button
        type="button"
        aria-label="Close"
        class="absolute top-4 right-4 p-2 text-white/70 hover:text-white transition-colors z-20
               focus:outline-none focus:ring-2 focus:ring-white"
        onClick={closeModal}
      >
        <X size={32} />
      </button>

      <div
        class="w-full h-full flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Photo */}
        <Show when={props.media.type === 'photo'}>
          <Show
            when={fullQuery.data}
            fallback={
              <div class="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full" />
            }
          >
            {(url) => (
              <img
                src={url()}
                alt="Full size"
                class="max-w-full max-h-full object-contain"
              />
            )}
          </Show>
        </Show>

        {/* Video Player */}
        <Show when={isVideo()}>
          <FullscreenVideoPlayer
            url={fullQuery.data ?? undefined}
            isLoading={fullQuery.isLoading}
            duration={props.media.duration ?? 0}
            isRound={props.media.type === 'video_note'}
            onClose={closeModal}
          />
        </Show>
      </div>
    </Motion.div>
  )
}

/**
 * Fullscreen video player with Telegram-style controls
 */
function FullscreenVideoPlayer(props: {
  url: string | undefined
  isLoading: boolean
  duration: number
  isRound?: boolean
  onClose: () => void
}) {
  const [isPlaying, setIsPlaying] = createSignal(false)
  const [currentTime, setCurrentTime] = createSignal(0)
  const [duration, setDuration] = createSignal(props.duration)
  const [showControls, setShowControls] = createSignal(true)
  const [isMuted, setIsMuted] = createSignal(false)
  let videoRef: HTMLVideoElement | undefined
  let hideControlsTimeout: number | undefined

  const progress = () => duration() > 0 ? (currentTime() / duration()) * 100 : 0

  // Auto-hide controls after 3 seconds
  const resetHideTimer = () => {
    setShowControls(true)
    clearTimeout(hideControlsTimeout)
    hideControlsTimeout = window.setTimeout(() => {
      if (isPlaying()) setShowControls(false)
    }, 3000)
  }

  // Auto-play when video loads
  createEffect(() => {
    if (props.url && videoRef) {
      videoRef.play().catch(() => {})
      resetHideTimer()
    }
  })

  const handleVideoClick = (e: MouseEvent) => {
    e.stopPropagation()
    if (!videoRef) return
    
    if (isPlaying()) {
      videoRef.pause()
    } else {
      videoRef.play()
    }
    resetHideTimer()
  }

  const handleProgressClick = (e: MouseEvent) => {
    e.stopPropagation()
    if (!videoRef || duration() === 0) return
    
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const percent = x / rect.width
    videoRef.currentTime = percent * duration()
  }

  const toggleMute = (e: MouseEvent) => {
    e.stopPropagation()
    if (!videoRef) return
    videoRef.muted = !videoRef.muted
    setIsMuted(videoRef.muted)
  }

  // Keyboard controls
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!videoRef) return
    
    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault()
        if (isPlaying()) videoRef.pause()
        else videoRef.play()
        break
      case 'ArrowLeft':
        e.preventDefault()
        videoRef.currentTime = Math.max(0, videoRef.currentTime - 5)
        break
      case 'ArrowRight':
        e.preventDefault()
        videoRef.currentTime = Math.min(duration(), videoRef.currentTime + 5)
        break
      case 'm':
        e.preventDefault()
        videoRef.muted = !videoRef.muted
        setIsMuted(videoRef.muted)
        break
    }
    resetHideTimer()
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown)
  })

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown)
    clearTimeout(hideControlsTimeout)
  })

  return (
    <div 
      class="relative w-full h-full flex items-center justify-center"
      onMouseMove={resetHideTimer}
      onClick={handleVideoClick}
    >
      {/* Loading spinner */}
      <Show when={props.isLoading || !props.url}>
        <div class="animate-spin w-10 h-10 border-3 border-white border-t-transparent rounded-full" />
      </Show>

      {/* Video */}
      <Show when={props.url}>
        {(url) => (
          <video
            ref={videoRef}
            src={url()}
            class={`max-w-full max-h-full ${props.isRound ? 'rounded-full' : ''}`}
            playsinline
            onPlay={() => setIsPlaying(true)}
            onPause={() => {
              setIsPlaying(false)
              setShowControls(true)
            }}
            onEnded={() => {
              setIsPlaying(false)
              setShowControls(true)
            }}
            onTimeUpdate={() => setCurrentTime(videoRef?.currentTime ?? 0)}
            onLoadedMetadata={() => setDuration(videoRef?.duration ?? props.duration)}
          />
        )}
      </Show>

      {/* Center play/pause indicator (shows briefly on toggle) */}
      <Show when={showControls() && !isPlaying() && props.url}>
        <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div class="w-20 h-20 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
            <Play size={40} class="text-white ml-1" fill="currentColor" />
          </div>
        </div>
      </Show>

      {/* Bottom controls */}
      <div 
        class={`absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent
                transition-opacity duration-300 ${showControls() ? 'opacity-100' : 'opacity-0'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress bar */}
        <div 
          class="w-full h-1 bg-white/30 rounded-full cursor-pointer mb-4 group"
          onClick={handleProgressClick}
        >
          {/* Buffered progress could go here */}
          <div 
            class="h-full bg-white rounded-full relative transition-all"
            style={{ width: `${progress()}%` }}
          >
            {/* Scrubber handle */}
            <div class="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full 
                        opacity-0 group-hover:opacity-100 transition-opacity shadow-lg" />
          </div>
        </div>

        {/* Controls row */}
        <div class="flex items-center gap-4">
          {/* Play/Pause */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              handleVideoClick(e)
            }}
            class="p-2 text-white hover:text-white/80 transition-colors"
          >
            <Show when={isPlaying()} fallback={<Play size={28} fill="currentColor" />}>
              <Pause size={28} fill="currentColor" />
            </Show>
          </button>

          {/* Time */}
          <div class="text-white text-sm font-medium">
            {formatDuration(currentTime())} / {formatDuration(duration())}
          </div>

          {/* Spacer */}
          <div class="flex-1" />

          {/* Mute */}
          <button
            type="button"
            onClick={toggleMute}
            class="p-2 text-white hover:text-white/80 transition-colors"
          >
            <Show when={isMuted()} fallback={
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            }>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            </Show>
          </button>
        </div>
      </div>
    </div>
  )
}

// Helpers

function formatDuration(seconds: number): string {
  const totalSecs = Math.round(seconds)
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
