import { createSignal, Show, Match, Switch, For, onCleanup, createMemo, createEffect } from 'solid-js'
import { Portal } from 'solid-js/web'
import { DEFAULT_ASPECT_RATIO, MEDIA, isMobile } from '@/config/constants'
import type { MessageMedia } from '@/lib/telegram'
import { useMedia } from '@/lib/query'
import { mediaController } from '@/lib/media'
import { Skeleton, Lightbox, VideoModal, DownloadOverlay, type LightboxItem } from '@/components/ui'
import { Play, Pause, FileText, Music, MapPin, User, ExternalLink, Volume2, VolumeX } from 'lucide-solid'

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

  // Load large thumbnail for preview
  const mediaQuery = useMedia(
    () => props.channelId,
    () => props.messageId,
    () => 'large',
    isVisible
  )

  // Load full resolution for lightbox
  const fullQuery = useMedia(
    () => props.channelId,
    () => props.messageId,
    () => undefined,
    isExpanded
  )

  // Lightbox item for PhotoSwipe (photos only)
  const lightboxItems = (): LightboxItem[] => {
    if (props.media.type !== 'photo') return []
    const url = fullQuery.data
    if (!url) return []
    
    return [{
      src: url,
      width: props.media.width || MEDIA.DEFAULT_WIDTH,
      height: props.media.height || MEDIA.DEFAULT_HEIGHT,
      thumb: props.media.thumb,
    }]
  }
  
  const isVideoType = () => props.media.type === 'video' || props.media.type === 'video_note'

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
        rootMargin: isMobile ? '300px' : '600px',
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
        {/* Photo - thumbnail as base, full image fades in on top */}
        <Match when={props.media.type === 'photo'}>
          <div 
            class="relative rounded-2xl overflow-hidden flex-shrink-0 shadow-sm hover:shadow-md transition-shadow" 
            style={containerStyle()}
          >
            {/* Base layer: thumbnail with blur (always rendered if available) */}
            <Show
              when={props.media.thumb}
              fallback={<div class="absolute inset-0 skeleton" />}
            >
              <img
                src={props.media.thumb}
                alt=""
                class={`absolute inset-0 w-full h-full object-cover blur-sm scale-105 transition-opacity duration-300 ${
                  mediaQuery.data ? 'opacity-0' : 'opacity-100'
                }`}
                loading="lazy"
                decoding="async"
                width={props.media.width || MEDIA.DEFAULT_WIDTH}
                height={props.media.height || MEDIA.DEFAULT_HEIGHT}
              />
            </Show>
            {/* Top layer: full image - only mount when URL is ready to avoid empty src decode */}
            <Show when={mediaQuery.data}>
              {(url) => (
                <img
                  src={url()}
                  alt="Post media"
                  class="w-full h-full object-cover cursor-pointer hover:scale-[1.02] transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-accent animate-fade-in"
                  loading="lazy"
                  decoding="async"
                  width={props.media.width || MEDIA.DEFAULT_WIDTH}
                  height={props.media.height || MEDIA.DEFAULT_HEIGHT}
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
                  const percentage = () => {
                    const voters = props.media.pollVoters
                    return voters && voters > 0
                      ? Math.round((answer.voters / voters) * 100)
                      : 0
                  }
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
                  {(url) => (
                    <img
                      src={url()}
                      alt=""
                      class="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                      width={props.media.width || MEDIA.DEFAULT_WIDTH}
                      height={props.media.height || MEDIA.DEFAULT_HEIGHT}
                    />
                  )}
                </Show>
                <Show when={!mediaQuery.data}>
                  <Show when={props.media.thumb} fallback={<div class="absolute inset-0 skeleton" />}>
                    <img
                      src={props.media.thumb}
                      alt=""
                      class="absolute inset-0 w-full h-full object-cover blur-sm scale-105"
                      loading="lazy"
                      decoding="async"
                      width={props.media.width || MEDIA.DEFAULT_WIDTH}
                      height={props.media.height || MEDIA.DEFAULT_HEIGHT}
                    />
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

      {/* PhotoSwipe lightbox for photos */}
      <Lightbox
        items={lightboxItems()}
        index={0}
        open={isExpanded() && props.media.type === 'photo' && lightboxItems().length > 0}
        onClose={() => setIsExpanded(false)}
      />
      
      {/* Simple fullscreen modal for videos */}
      <Show when={isExpanded() && isVideoType()}>
        <Portal>
          <VideoModal
            url={fullQuery.data ?? undefined}
            isLoading={fullQuery.isLoading || fullQuery.isFetching}
            isError={fullQuery.isError}
            isRound={props.media.type === 'video_note'}
            onClose={() => setIsExpanded(false)}
            onRetry={() => fullQuery.refetch()}
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
              preload="metadata"
              poster={props.media.thumb}
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
            <img
              src={props.media.thumb}
              alt=""
              class="w-full h-full object-cover blur-sm scale-105"
              loading="lazy"
              decoding="async"
              width={props.media.width || MEDIA.DEFAULT_WIDTH}
              height={props.media.height || MEDIA.DEFAULT_HEIGHT}
            />
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
  // Blocked until video is fully downloaded
  const handleVideoClick = (e: MouseEvent) => {
    e.stopPropagation()
    if (!videoQuery.data) return
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
      class={`relative rounded-2xl overflow-hidden flex-shrink-0 shadow-sm hover:shadow-md transition-shadow bg-black ${videoQuery.data ? 'cursor-pointer' : ''}`}
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
            preload="metadata"
            poster={props.media.thumb}
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
            <img
              src={props.media.thumb}
              alt=""
              class="w-full h-full object-cover blur-sm scale-105"
              loading="lazy"
              decoding="async"
              width={props.media.width || MEDIA.DEFAULT_WIDTH}
              height={props.media.height || MEDIA.DEFAULT_HEIGHT}
            />
          </Show>
        }>
          {(url) => (
            <img
              src={url()}
              alt="Video thumbnail"
              class="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
              width={props.media.width || MEDIA.DEFAULT_WIDTH}
              height={props.media.height || MEDIA.DEFAULT_HEIGHT}
            />
          )}
        </Show>
      </Show>

      {/* Download state overlay — loading / error / ready */}
      <Show when={!isPlaying()}>
        <DownloadOverlay
          state={!videoQuery.data ? (videoQuery.isError ? 'error' : 'loading') : 'ready'}
          fileSize={!videoQuery.data && props.media.size ? formatFileSize(props.media.size) : undefined}
          onRetry={() => videoQuery.refetch()}
        />
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
            {(_) => (
              <div class="px-2 py-1 rounded-lg bg-black/40 text-white text-xs font-medium backdrop-blur-sm">
                {formatDuration(props.media.duration ?? 0)}
              </div>
            )}
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
              <img
                src={url()}
                alt={props.media.stickerEmoji || 'Sticker'}
                class="w-full h-full object-contain drop-shadow-md"
                loading="lazy"
                decoding="async"
                width={props.media.width || 160}
                height={props.media.height || 160}
              />
            </Match>
            <Match when={stickerType() === 'video'}>
              <video
                src={url()}
                class="w-full h-full object-contain drop-shadow-md"
                autoplay
                muted
                loop
                playsinline
                preload="metadata"
                poster={props.media.thumb}
              />
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
          <img
            src={props.media.thumb}
            alt=""
            class="absolute inset-0 w-full h-full object-contain blur-sm"
            loading="lazy"
            decoding="async"
            width={props.media.width || 160}
            height={props.media.height || 160}
          />
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
          <video
            src={url()}
            class="w-full h-full object-cover"
            autoplay
            muted
            loop
            playsinline
            preload="metadata"
            poster={props.media.thumb}
          />
        )}
      </Show>
      <Show when={!gifQuery.data}>
        <Show when={props.media.thumb} fallback={<div class="absolute inset-0 skeleton" />}>
          <img
            src={props.media.thumb}
            alt=""
            class="absolute inset-0 w-full h-full object-cover blur-sm scale-105"
            loading="lazy"
            decoding="async"
            width={props.media.width || MEDIA.DEFAULT_WIDTH}
            height={props.media.height || MEDIA.DEFAULT_HEIGHT}
          />
        </Show>
      </Show>
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
