import { Show, For } from 'solid-js'
import { UserAvatar, TimeAgo } from '@/components/ui'
import { PostContent, PostMedia } from '@/components/post'
import type { Comment } from '@/lib/telegram'
import { CornerDownRight, ChevronDown } from 'lucide-solid'
import type { CommentActionsContext } from './CommentThread'

interface CommentItemProps {
  comment: Comment
  /** Discussion chat ID for media loading */
  discussionChatId?: number
  onReply?: (commentId: number) => void
  isReplying?: boolean
  /** Context for showing/expanding replies */
  repliesContext?: CommentActionsContext
}

/**
 * Individual comment display - Twitter/Threads style
 *
 * Avatar on left with optional thread line extending below.
 * Content on right with author, time, text, media, reactions.
 */
export function CommentItem(props: CommentItemProps) {
  return (
    <div class="flex gap-3">
      {/* Avatar */}
      <div class="flex-shrink-0 pt-0.5">
        <UserAvatar
          userId={props.comment.author.id}
          name={props.comment.author.name}
          size="sm"
        />
      </div>

      {/* Content */}
      <div class="flex-1 min-w-0 pb-4">
        {/* Forward indicator */}
        <Show when={props.comment.forward}>
          {(forward) => (
            <div class="flex items-center gap-1.5 text-xs text-tertiary mb-1">
              <CornerDownRight size={12} class="flex-shrink-0" />
              <span class="truncate">
                Forwarded from <span class="text-accent">{forward().senderName}</span>
              </span>
            </div>
          )}
        </Show>

        {/* Reply-to indicator */}
        <Show when={props.comment.replyToAuthor}>
          {(replyTo) => (
            <div class="flex items-center gap-1.5 text-xs text-tertiary mb-1">
              <CornerDownRight size={12} class="flex-shrink-0 -scale-x-100" />
              <span class="truncate">
                In reply to <span class="text-accent">{replyTo().name}</span>
              </span>
            </div>
          )}
        </Show>

        {/* Header */}
        <div class="flex items-center gap-2 min-w-0">
          <span class="font-medium text-primary text-sm truncate">
            {props.comment.author.name}
          </span>
          <TimeAgo date={props.comment.date} relative class="text-xs text-tertiary flex-shrink-0" />
        </div>

        {/* Text with entities */}
        <Show when={props.comment.text}>
          <div class="mt-1">
            <PostContent
              text={props.comment.text}
              entities={props.comment.entities}
              class="text-sm"
            />
          </div>
        </Show>

        {/* Media */}
        <Show when={props.comment.media}>
          {(media) => (
            <Show
              when={props.discussionChatId}
              fallback={
                <div class="mt-2 px-3 py-2 rounded-lg bg-[var(--glass-bg)] text-xs text-tertiary">
                  Media attachment
                </div>
              }
            >
              {(chatId) => (
                <div class="mt-2">
                  <PostMedia
                    channelId={chatId()}
                    messageId={props.comment.id}
                    media={media()}
                    class="rounded-lg max-w-xs"
                  />
                </div>
              )}
            </Show>
          )}
        </Show>

        {/* Reactions */}
        <Show when={props.comment.reactions && props.comment.reactions.length > 0}>
          <div class="flex flex-wrap gap-1 mt-2">
            <For each={props.comment.reactions}>
              {(reaction) => (
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--glass-bg)] text-xs">
                  <span>{reaction.emoji}</span>
                  <span class="text-tertiary">{reaction.count}</span>
                </span>
              )}
            </For>
          </div>
        </Show>

        {/* Actions row */}
        <div class="flex items-center gap-1 mt-1 -ml-1">
          {/* Reply action */}
          <button
            type="button"
            onClick={() => props.onReply?.(props.comment.id)}
            class={`
              px-2 py-1 rounded-lg text-xs font-medium
              transition-colors duration-150
              ${props.isReplying 
                ? 'text-accent' 
                : 'text-tertiary active:text-accent'}
            `}
          >
            Reply
          </button>

          {/* View/hide replies button - inline with Reply */}
          <Show when={props.repliesContext}>
            {(ctx) => (
              <button
                type="button"
                onClick={() => ctx().onShowReplies()}
                class="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-accent active:opacity-70 transition-opacity duration-150"
              >
                <ChevronDown
                  size={14}
                  style={ctx().showReplies ? { transform: 'rotate(180deg)', transition: 'transform 0.2s' } : { transition: 'transform 0.2s' }}
                />
                <span>
                  {ctx().showReplies
                    ? 'Hide replies'
                    : `${ctx().replyCount} ${ctx().replyCount === 1 ? 'reply' : 'replies'}`}
                </span>
              </button>
            )}
          </Show>
        </div>
      </div>
    </div>
  )
}

