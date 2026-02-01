import { Show, createMemo } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { ChannelAvatar } from '@/components/ui'
import { PostContent, PostMedia, PostActions } from '@/components/post'
import { formatTimeAgo, globalNow } from '@/lib/utils'
import { CornerDownRight } from 'lucide-solid'
import type { Message } from '@/lib/telegram'

interface TimelinePostProps {
  post: Message
  channelTitle: string
  channelId: number
  /** Channel username for pretty URLs (e.g., /@username) */
  channelUsername?: string
  style?: Record<string, string>
  onCommentClick?: () => void
}

// Approximate character count for 4 lines
const TRUNCATE_THRESHOLD = 280

/**
 * Individual post in the timeline
 *
 * Clean layout without card wrapper - posts flow directly on background.
 * Actions use pill-style buttons.
 */
export function TimelinePost(props: TimelinePostProps) {
  const navigate = useNavigate()

  // Generate URLs - prefer username for pretty URLs (memoized)
  const channelUrl = createMemo(() =>
    props.channelUsername ? `/c/${props.channelUsername}` : `/channel/${props.channelId}`
  )

  const postUrl = createMemo(() =>
    props.channelUsername
      ? `/c/${props.channelUsername}/${props.post.id}`
      : `/post/${props.post.channelId}/${props.post.id}`
  )

  const handlePostClick = () => {
    navigate(postUrl())
  }

  const handleChannelClick = (e: Event) => {
    e.stopPropagation()
    navigate(channelUrl())
  }

  // Memoize with global time signal for periodic updates
  const timeAgo = createMemo(() => {
    globalNow() // Subscribe to minute-by-minute time updates
    return formatTimeAgo(props.post.date)
  })

  // Check if text is long enough to be truncated
  const isTruncated = createMemo(() => {
    if (!props.post.text) return false
    // Check character count or line breaks
    return props.post.text.length > TRUNCATE_THRESHOLD ||
           (props.post.text.match(/\n/g) || []).length > 3
  })

  return (
    <article class="post cursor-pointer" style={props.style} onClick={handlePostClick}>
      {/* Forward indicator */}
      <Show when={props.post.forward}>
        {(forward) => (
          <div class="flex items-center gap-2 px-4 pt-3 pb-1 text-sm text-tertiary">
            <CornerDownRight size={16} class="flex-shrink-0" />
            <span class="truncate">
              Forwarded from{' '}
              <span class="text-accent font-medium">{forward().senderName}</span>
              <Show when={forward().signature}>
                {(sig) => <span class="text-tertiary"> ({sig()})</span>}
              </Show>
            </span>
          </div>
        )}
      </Show>

      {/* Header */}
      <div class="post-header">
        <div onClick={handleChannelClick}>
          <ChannelAvatar
            channelId={props.channelId}
            name={props.channelTitle}
            size="md"
            class="cursor-pointer"
          />
        </div>
        <div class="flex-1 min-w-0 overflow-hidden">
          <button
            onClick={handleChannelClick}
            class="font-semibold text-primary hover:underline truncate block max-w-full text-left"
          >
            {props.channelTitle}
          </button>
          <div class="flex items-center gap-1 text-sm text-tertiary">
            <span>{timeAgo()}</span>
            <Show when={props.post.editDate}>
              <span>· edited</span>
            </Show>
          </div>
        </div>
      </div>

      {/* Text content - truncated like Twitter */}
      <Show when={props.post.text}>
        <div class="post-content">
          <PostContent
            text={props.post.text}
            entities={props.post.entities}
            truncate
            maxLines={4}
          />
          <Show when={isTruncated()}>
            <span class="text-accent text-sm mt-1 inline-block">Show more</span>
          </Show>
        </div>
      </Show>

      {/* Media */}
      <Show when={props.post.media}>
        <div class="post-media">
          <PostMedia
            channelId={props.post.channelId}
            messageId={props.post.id}
            media={props.post.media!}
            class="mx-4 rounded-2xl overflow-hidden"
          />
        </div>
      </Show>

      {/* Actions */}
      <div class="post-actions" onClick={(e) => e.stopPropagation()}>
        <PostActions
          channelId={props.post.channelId}
          messageId={props.post.id}
          channelTitle={props.channelTitle}
          preview={props.post.text}
          views={props.post.views}
          replies={props.post.replies}
          reactions={props.post.reactions}
          onCommentClick={props.onCommentClick ?? handlePostClick}
        />
      </div>
    </article>
  )
}

