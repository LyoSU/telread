import { For, createMemo, createSignal, type JSX } from 'solid-js'
import type { MessageEntity } from '@/lib/telegram'

interface PostContentProps {
  text: string
  entities?: MessageEntity[]
  class?: string
  truncate?: boolean
  maxLines?: number
}

interface TextSegment {
  text: string
  entities: MessageEntity[]
}

// Priority order for nesting (lower = outer wrapper)
const PRIORITY: Record<string, number> = {
  blockquote: 0,
  link: 1, url: 1, mention: 2, text_mention: 2, hashtag: 3, cashtag: 3, bot_command: 3,
  email: 4, phone: 4,
  spoiler: 5, pre: 6, code: 7, 
  bold: 8, italic: 9, underline: 10, strikethrough: 11,
  custom_emoji: 12,
}

// Auto-detect URLs in text (when Telegram doesn't mark them as entities)
// Matches: https://..., http://..., www....
const URL_REGEX = /^(https?:\/\/|www\.)\S+$/i

/**
 * Wrap text with a single entity type
 */
function EntityTag(props: { type: string; url?: string; text: string; children: JSX.Element }) {
  const { type, url, text, children } = props

  switch (type) {
    case 'bold':
      return <strong class="font-bold">{children}</strong>
    case 'italic':
      return <em>{children}</em>
    case 'underline':
      return <u class="decoration-1 underline-offset-2">{children}</u>
    case 'strikethrough':
      return <s>{children}</s>
    case 'code':
      return (
        <code class="px-1 py-0.5 rounded bg-[var(--text-primary)]/[0.06] font-mono text-[0.9em] text-[var(--text-primary)]">
          {children}
        </code>
      )
    case 'pre':
      return (
        <pre class="my-2 p-3 rounded-lg bg-[var(--text-primary)]/[0.06] overflow-x-auto text-[0.9em]">
          <code class="font-mono text-[var(--text-primary)]">{children}</code>
        </pre>
      )
    case 'link':
    case 'url':
      return (
        <a 
          href={url || text} 
          target="_blank" 
          rel="noopener noreferrer" 
          class="text-accent hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </a>
      )
    case 'mention':
    case 'text_mention':
    case 'hashtag':
    case 'cashtag':
    case 'bot_command':
      return <span class="text-accent">{children}</span>
    case 'email':
      return (
        <a href={`mailto:${text}`} class="text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
          {children}
        </a>
      )
    case 'phone':
      return (
        <a href={`tel:${text.replace(/\s/g, '')}`} class="text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
          {children}
        </a>
      )
    case 'spoiler':
      return <SpoilerTag>{children}</SpoilerTag>
    case 'blockquote':
      return (
        <blockquote class="border-l-[3px] border-[var(--text-tertiary)]/50 pl-3 my-1">
          {children}
        </blockquote>
      )
    case 'custom_emoji':
      return <>{children}</>
    default:
      return <>{children}</>
  }
}

function SpoilerTag(props: { children: JSX.Element }) {
  const [revealed, setRevealed] = createSignal(false)
  
  return (
    <span
      class={revealed() 
        ? 'transition-all duration-200' 
        : 'bg-[var(--text-tertiary)] text-transparent rounded select-none cursor-pointer hover:bg-[var(--text-secondary)] transition-colors'
      }
      onClick={(e) => {
        if (!revealed()) {
          e.stopPropagation()
          setRevealed(true)
        }
      }}
    >
      {props.children}
    </span>
  )
}

/**
 * Renders a segment with entities applied
 * Simple implementation without Switch/Match to avoid cleanup issues
 */
function SegmentRenderer(props: { segment: TextSegment }) {
  const text = props.segment.text
  const entities = props.segment.entities

  // Check if text is a URL but has no url/link entity (auto-detect)
  const hasLinkEntity = entities.some(e => e.type === 'url' || e.type === 'link')
  const isAutoUrl = !hasLinkEntity && URL_REGEX.test(text)
  const autoHref = isAutoUrl ? (text.startsWith('http') ? text : `https://${text}`) : ''

  // No entities - check for auto-URL
  if (entities.length === 0) {
    if (isAutoUrl) {
      return (
        <a href={autoHref} target="_blank" rel="noopener noreferrer" class="text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
          {text}
        </a>
      )
    }
    return <>{text}</>
  }

  // Sort by priority
  const sorted = [...entities].sort((a, b) => (PRIORITY[a.type] ?? 99) - (PRIORITY[b.type] ?? 99))

  // Build content (innermost)
  let content: JSX.Element = <>{text}</>

  // Wrap with entities from inside out (reverse order)
  for (let i = sorted.length - 1; i >= 0; i--) {
    content = (
      <EntityTag type={sorted[i].type} url={sorted[i].url} text={text}>
        {content}
      </EntityTag>
    )
  }

  // If auto-URL detected, wrap everything with link
  if (isAutoUrl) {
    return (
      <a href={autoHref} target="_blank" rel="noopener noreferrer" class="text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
        {content}
      </a>
    )
  }

  return content
}

/**
 * Renders post text with Telegram entities (formatting)
 *
 * Supports overlapping entities - e.g., bold + italic on same text.
 * Uses interval-based algorithm to handle multiple formatting on same characters.
 */
export function PostContent(props: PostContentProps) {
  const segments = createMemo((): TextSegment[] => {
    const text = props.text
    if (!text) return []

    const entities = props.entities
    if (!entities || entities.length === 0) {
      return [{ text, entities: [] }]
    }

    // Collect all unique boundary points
    const points = new Set<number>([0, text.length])
    for (const entity of entities) {
      const start = Math.max(0, entity.offset)
      const end = Math.min(text.length, entity.offset + entity.length)
      if (start < end) {
        points.add(start)
        points.add(end)
      }
    }

    const sortedPoints = [...points].sort((a, b) => a - b)
    const result: TextSegment[] = []

    for (let i = 0; i < sortedPoints.length - 1; i++) {
      const start = sortedPoints[i]
      const end = sortedPoints[i + 1]
      if (start >= end) continue

      const activeEntities = entities.filter((e) => {
        const eStart = Math.max(0, e.offset)
        const eEnd = Math.min(text.length, e.offset + e.length)
        return eStart <= start && eEnd >= end
      })

      result.push({ text: text.slice(start, end), entities: activeEntities })
    }

    return result
  })

  const lineClampClass = () => {
    if (!props.truncate) return ''
    const lines = props.maxLines ?? 4
    if (lines <= 2) return 'line-clamp-2'
    if (lines <= 3) return 'line-clamp-3'
    if (lines <= 4) return 'line-clamp-4'
    if (lines <= 5) return 'line-clamp-5'
    return 'line-clamp-6'
  }

  return (
    <div
      class={`whitespace-pre-wrap break-words text-primary leading-relaxed ${lineClampClass()} ${props.class ?? ''}`}
    >
      <For each={segments()}>{(segment) => <SegmentRenderer segment={segment} />}</For>
    </div>
  )
}
