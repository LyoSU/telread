import { For, Show, createSignal } from 'solid-js'
import { CommentItem } from './CommentItem'
import { ReplyComposer } from './ReplyComposer'
import type { Comment } from '@/lib/telegram'

interface CommentThreadProps {
  comment: Comment
  /** Discussion chat ID for media loading */
  discussionChatId?: number
  onReply?: (text: string, replyToId?: number) => void
  isSending?: boolean
  /** Show thread line connecting to next comment */
  showThreadLine?: boolean
  /** Is this a nested reply (not top-level) */
  isNested?: boolean
}

export interface CommentActionsContext {
  hasReplies: boolean
  replyCount: number
  showReplies: boolean
  onShowReplies: () => void
}

/**
 * Threads-style comment display
 *
 * Replies are collapsed by default, expand on click.
 */
export function CommentThread(props: CommentThreadProps) {
  const [isReplying, setIsReplying] = createSignal(false)
  const [showReplies, setShowReplies] = createSignal(props.isNested ?? false)

  const hasReplies = () =>
    props.comment.replies && props.comment.replies.length > 0

  const replyCount = () => props.comment.replies?.length ?? 0

  const handleReply = (text: string) => {
    props.onReply?.(text, props.comment.id)
    setIsReplying(false)
    setShowReplies(true) // Show replies after sending one
  }

  // Show thread line if replies are expanded
  const showLine = () => props.showThreadLine || (hasReplies() && showReplies())

  return (
    <div>
      <CommentItem
        comment={props.comment}
        discussionChatId={props.discussionChatId}
        onReply={() => setIsReplying(!isReplying())}
        isReplying={isReplying()}
        showThreadLine={showLine()}
        repliesContext={hasReplies() && !showReplies() ? {
          hasReplies: hasReplies() ?? false,
          replyCount: replyCount(),
          showReplies: showReplies(),
          onShowReplies: () => setShowReplies(true),
        } : undefined}
      />

      {/* Reply composer */}
      <Show when={isReplying()}>
        <div class="ml-10 mb-3">
          <ReplyComposer
            onSubmit={handleReply}
            onCancel={() => setIsReplying(false)}
            isSending={props.isSending}
          />
        </div>
      </Show>



      {/* Expanded replies */}
      <Show when={hasReplies() && showReplies()}>
        <For each={props.comment.replies}>
          {(reply, index) => (
            <CommentThread
              comment={reply}
              discussionChatId={props.discussionChatId}
              onReply={props.onReply}
              isSending={props.isSending}
              showThreadLine={index() < props.comment.replies!.length - 1}
              isNested
            />
          )}
        </For>
      </Show>
    </div>
  )
}
