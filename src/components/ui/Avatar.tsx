import { Show, createMemo } from 'solid-js'
import { AVATAR_SIZES } from '@/config/constants'

interface AvatarProps {
  src?: string | null
  name?: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  class?: string
  onClick?: () => void
}

const sizeStyles = {
  xs: 'w-6 h-6 text-2xs',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-lg',
}

// Telegram-style solid colors for avatars
const avatarColors = [
  '#e17076', // red
  '#7bc862', // green
  '#e5ca77', // yellow
  '#65aadd', // blue
  '#a695e7', // purple
  '#ee7aae', // pink
  '#6ec9cb', // cyan
  '#faa774', // orange
]

function getColorFromName(name: string): string {
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return avatarColors[hash % avatarColors.length]
}

/**
 * Avatar - User avatar with Telegram-style coloring
 *
 * Shows image if available, otherwise displays initials
 * with a solid background color based on the user's name.
 */
export function Avatar(props: AvatarProps) {
  const initials = createMemo(() => {
    if (!props.name) return '?'
    const parts = props.name.trim().split(/\s+/)
    if (parts.length === 1) {
      return parts[0].charAt(0).toUpperCase()
    }
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
  })

  const bgColor = createMemo(() => getColorFromName(props.name ?? ''))
  
  const pixelSize = createMemo(() => AVATAR_SIZES[props.size ?? 'md'])

  return (
    <div
      class={`
        avatar flex-shrink-0
        ${sizeStyles[props.size ?? 'md']}
        ${props.onClick ? 'cursor-pointer' : ''}
        ${props.class ?? ''}
      `}
      onClick={props.onClick}
    >
      <Show
        when={props.src}
        fallback={
          <div
            class="w-full h-full flex items-center justify-center font-medium text-white"
            style={{ background: bgColor() }}
          >
            {initials()}
          </div>
        }
      >
        <img
          src={props.src!}
          alt={props.name ?? 'Avatar'}
          class="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          width={pixelSize()}
          height={pixelSize()}
        />
      </Show>
    </div>
  )
}
