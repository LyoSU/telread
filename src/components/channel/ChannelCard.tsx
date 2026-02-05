import { Show, createMemo, createResource, createSignal, createEffect, onCleanup } from 'solid-js'
import { ChannelAvatar, GlassButton } from '@/components/ui'
import { downloadProfilePhoto, isClientReady } from '@/lib/telegram'
import type { ChannelFullInfo } from '@/lib/telegram'
import { Check, Shield, AlertTriangle, BadgeCheck, Users, Clock, Send } from 'lucide-solid'
import { MEDIA } from '@/config/constants'

interface ChannelCardProps {
  channel: ChannelFullInfo
  onUnsubscribe?: () => void
  isUnsubscribing?: boolean
  class?: string
}

// Cache extracted colors by URL to avoid redundant canvas operations
const colorCache = new Map<string, { h: number; s: number; l: number } | null>()

/**
 * Extract dominant color from image using canvas sampling
 * Returns HSL color for easy manipulation. Results are cached by URL.
 */
function extractDominantColor(imageUrl: string): Promise<{ h: number; s: number; l: number } | null> {
  const cached = colorCache.get(imageUrl)
  if (cached !== undefined) return Promise.resolve(cached)
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(null)
          return
        }

        // Sample at small size for performance
        const size = MEDIA.COLOR_EXTRACT_SIZE
        canvas.width = size
        canvas.height = size
        ctx.drawImage(img, 0, 0, size, size)

        const imageData = ctx.getImageData(0, 0, size, size).data
        let r = 0, g = 0, b = 0, count = 0

        // Sample pixels, skip very dark/light ones
        for (let i = 0; i < imageData.length; i += 16) { // Sample every 4th pixel
          const pr = imageData[i]
          const pg = imageData[i + 1]
          const pb = imageData[i + 2]
          const brightness = (pr + pg + pb) / 3

          // Skip very dark or very light pixels
          if (brightness > MEDIA.BRIGHTNESS_MIN && brightness < MEDIA.BRIGHTNESS_MAX) {
            r += pr
            g += pg
            b += pb
            count++
          }
        }

        if (count === 0) {
          resolve(null)
          return
        }

        r = Math.round(r / count)
        g = Math.round(g / count)
        b = Math.round(b / count)

        // Convert RGB to HSL
        const rNorm = r / 255
        const gNorm = g / 255
        const bNorm = b / 255
        const max = Math.max(rNorm, gNorm, bNorm)
        const min = Math.min(rNorm, gNorm, bNorm)
        let h = 0
        let s = 0
        const l = (max + min) / 2

        if (max !== min) {
          const d = max - min
          s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
          switch (max) {
            case rNorm: h = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) / 6; break
            case gNorm: h = ((bNorm - rNorm) / d + 2) / 6; break
            case bNorm: h = ((rNorm - gNorm) / d + 4) / 6; break
          }
        }

        const color = { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
        colorCache.set(imageUrl, color)
        resolve(color)
      } catch {
        colorCache.set(imageUrl, null)
        resolve(null)
      }
    }
    img.onerror = () => { colorCache.set(imageUrl, null); resolve(null) }
    img.src = imageUrl
  })
}

/**
 * ChannelCard - Twitter-style profile card for Telegram channels
 *
 * Features:
 * - Glassmorphism design with dynamic gradient from avatar
 * - Large avatar with verification badge
 * - Channel stats (subscribers, online)
 * - Description
 * - Action buttons
 */
export function ChannelCard(props: ChannelCardProps) {
  const [dominantColor, setDominantColor] = createSignal<{ h: number; s: number; l: number } | null>(null)

  // Load large avatar for banner blur effect
  const [bannerUrl] = createResource(
    () => ({ id: props.channel.id, ready: isClientReady() }),
    async ({ id, ready }) => {
      if (!id || !ready) return null
      try {
        return await downloadProfilePhoto(id, 'big')
      } catch {
        return null
      }
    }
  )

  // Extract dominant color when banner loads
  createEffect(() => {
    const url = bannerUrl()
    if (url) {
      let cancelled = false
      extractDominantColor(url).then((color) => {
        if (!cancelled) setDominantColor(color)
      })
      onCleanup(() => { cancelled = true })
    }
  })

  // Generate gradient style based on dominant color
  const gradientStyle = createMemo(() => {
    const color = dominantColor()
    if (!color) {
      return { background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent) 50%, hsl(var(--accent-h) var(--accent-s) 30%) 100%)' }
    }
    // Create a vibrant gradient using the dominant color
    const { h, s, l } = color
    const satBoost = Math.min(s + 20, 90) // Boost saturation for vibrancy
    return {
      background: `linear-gradient(135deg, hsl(${h} ${satBoost}% ${Math.min(l + 15, 60)}%) 0%, hsl(${h} ${satBoost}% ${l}%) 50%, hsl(${(h + 30) % 360} ${satBoost}% ${Math.max(l - 10, 25)}%) 100%)`
    }
  })

  const formattedSubscribers = createMemo(() => {
    const count = props.channel.participantsCount
    if (!count) return null
    if (count < 1000) return count.toString()
    if (count < 1000000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}K`
    return `${(count / 1000000).toFixed(2).replace(/\.00$/, '').replace(/0$/, '')}M`
  })

  const formattedOnline = createMemo(() => {
    const count = props.channel.onlineCount
    if (!count) return null
    if (count < 1000) return count.toString()
    return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}K`
  })

  // Track if banner is ready (has dominant color or loaded)
  const bannerReady = createMemo(() => !!dominantColor() || !!bannerUrl())

  return (
    <div class={`relative overflow-hidden rounded-3xl ${props.class ?? ''}`}>
      {/* Banner with blurred avatar background */}
      <div class="relative h-28 overflow-hidden">
        {/* Neutral base layer */}
        <div class="absolute inset-0 bg-[var(--bg-secondary)]" />
        
        {/* Dynamic gradient - fades in smoothly */}
        <div 
          class="absolute inset-0 transition-opacity duration-500"
          classList={{ 'opacity-0': !bannerReady(), 'opacity-100': bannerReady() }}
          style={gradientStyle()} 
        />

        {/* Blurred avatar as banner - fades in via CSS */}
        <Show when={bannerUrl()}>
          {(url) => (
            <img
              src={url()}
              alt=""
              class="absolute inset-0 w-full h-full object-cover scale-150 blur-2xl transition-opacity duration-700"
              style={{ opacity: dominantColor() ? 0.6 : 0 }}
            />
          )}
        </Show>

        {/* Glass overlay for depth */}
        <div class="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[var(--bg-primary)]/80" />

        {/* Badges in top-right */}
        <div class="absolute top-3 right-3 flex items-center gap-2">
          <Show when={props.channel.isVerified}>
            <div class="flex items-center gap-1 px-2 py-1 rounded-full bg-blue-500/90 text-white text-xs font-medium shadow-lg">
              <Check size={12} />
              Verified
            </div>
          </Show>
          <Show when={props.channel.isProtected}>
            <div class="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/90 text-white text-xs font-medium shadow-lg">
              <Shield size={12} />
              Protected
            </div>
          </Show>
          <Show when={props.channel.isScam}>
            <div class="flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/90 text-white text-xs font-medium shadow-lg">
              <AlertTriangle size={12} />
              Scam
            </div>
          </Show>
        </div>
      </div>

      {/* Content card with glass effect */}
      <div class="relative glass-card -mt-8 mx-3 mb-3 p-4">
        {/* Avatar - positioned to overlap banner */}
        <div class="flex items-end gap-4 -mt-14 mb-3">
          <div class="relative">
            <div class="ring-4 ring-[var(--bg-primary)] rounded-full">
              <ChannelAvatar
                channelId={props.channel.id}
                name={props.channel.title}
                size="xl"
                class="w-20 h-20"
              />
            </div>
            {/* Online indicator dot */}
            <Show when={props.channel.onlineCount && props.channel.onlineCount > 0}>
              <div class="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-green-500 ring-2 ring-[var(--bg-primary)]" />
            </Show>
          </div>

          {/* Action buttons aligned right */}
          <div class="flex-1 flex justify-end gap-2">
            <Show when={props.channel.username}>
              <a
                href={`https://t.me/${props.channel.username}`}
                target="_blank"
                rel="noopener noreferrer"
                class="glass-btn px-3 py-1.5 text-sm font-medium text-primary rounded-xl flex items-center gap-1.5"
                title="Open in Telegram"
              >
                <Send size={16} />
              </a>
            </Show>
            <Show when={props.onUnsubscribe}>
              <GlassButton
                variant="danger"
                size="sm"
                onClick={props.onUnsubscribe}
                loading={props.isUnsubscribing}
              >
                Unsubscribe
              </GlassButton>
            </Show>
          </div>
        </div>

        {/* Channel info */}
        <div class="space-y-3">
          {/* Name and username */}
          <div class="min-w-0">
            <h1 class="text-xl font-bold text-primary flex items-center gap-2 min-w-0">
              <span class="truncate">{props.channel.title}</span>
              <Show when={props.channel.isVerified}>
                <BadgeCheck size={20} class="text-blue-500 flex-shrink-0" />
              </Show>
            </h1>
            <Show when={props.channel.username}>
              <p class="text-sm text-secondary truncate">@{props.channel.username}</p>
            </Show>
          </div>

          {/* Description */}
          <Show when={props.channel.description}>
            <p class="text-sm text-primary leading-relaxed whitespace-pre-wrap line-clamp-4">
              {props.channel.description}
            </p>
          </Show>

          {/* Stats row */}
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2">
            <Show when={formattedSubscribers()}>
              <div class="flex items-center gap-1.5">
                <Users size={16} class="text-tertiary" />
                <span class="text-sm">
                  <span class="font-semibold text-primary">{formattedSubscribers()}</span>
                  <span class="text-tertiary ml-1">subscribers</span>
                </span>
              </div>
            </Show>

            <Show when={formattedOnline()}>
              <div class="flex items-center gap-1.5">
                <div class="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span class="text-sm">
                  <span class="font-semibold text-primary">{formattedOnline()}</span>
                  <span class="text-tertiary ml-1">online</span>
                </span>
              </div>
            </Show>

            <Show when={props.channel.slowmodeSeconds && props.channel.slowmodeSeconds > 0}>
              <div class="flex items-center gap-1.5">
                <Clock size={16} class="text-tertiary" />
                <span class="text-sm text-tertiary">
                  Slowmode {formatSlowmode(props.channel.slowmodeSeconds!)}
                </span>
              </div>
            </Show>
          </div>

        </div>
      </div>
    </div>
  )
}

function formatSlowmode(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h`
}
