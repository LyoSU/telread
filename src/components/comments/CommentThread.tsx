import { For, Show, createSignal, createMemo } from 'solid-js'
import { CommentItem } from './CommentItem'
import { ReplyComposer } from './ReplyComposer'
import { getTime } from '@/lib/utils'
import type { Comment } from '@/lib/telegram'

interface CommentThreadProps {
  comment: Comment
  /** Discussion chat ID for media loading */
  discussionChatId?: number
  onReply?: (text: string, replyToId?: number) => void
  isSending?: boolean
}

export interface CommentActionsContext {
  hasReplies: boolean
  replyCount: number
  showReplies: boolean
  onShowReplies: () => void
}

/** Count all descendants recursively */
function countAllReplies(comment: Comment): number {
  const replies = comment.replies
  if (!replies || replies.length === 0) return 0
  let count = replies.length
  for (const reply of replies) {
    count += countAllReplies(reply)
  }
  return count
}

/** Flatten nested tree into chronological list */
function flattenReplies(replies: Comment[]): Comment[] {
  const result: Comment[] = []
  const walk = (comments: Comment[]) => {
    for (const c of comments) {
      result.push(c)
      if (c.replies) walk(c.replies)
    }
  }
  walk(replies)
  result.sort((a, b) => getTime(a.date) - getTime(b.date))
  return result
}

/**
 * Comment thread — top-level comment with flat reply list
 *
 * Replies are collapsed by default. When expanded, all nested replies
 * are flattened into a chronological list with a left border.
 * "In reply to [name]" indicators show conversation flow.
 */
export function CommentThread(props: CommentThreadProps) {
  const [replyTargetId, setReplyTargetId] = createSignal<number | undefined>()
  const [showReplies, setShowReplies] = createSignal(false)

  const hasReplies = () =>
    props.comment.replies && props.comment.replies.length > 0

  const totalReplies = createMemo(() => countAllReplies(props.comment))

  const flat = createMemo(() => {
    if (!props.comment.replies) return []
    return flattenReplies(props.comment.replies)
  })

  const isReplying = () => replyTargetId() !== undefined

  const handleSendReply = (text: string) => {
    props.onReply?.(text, replyTargetId())
    setReplyTargetId(undefined)
    setShowReplies(true)
  }

  const startReply = (targetId: number) => {
    setReplyTargetId(targetId)
    setShowReplies(true)
  }

  const cancelReply = () => {
    setReplyTargetId(undefined)
  }

  return (
    <div>
      {/* Root comment */}
      <CommentItem
        comment={props.comment}
        discussionChatId={props.discussionChatId}
        onReply={() => startReply(props.comment.id)}
        isReplying={replyTargetId() === props.comment.id}
        repliesContext={hasReplies() ? {
          hasReplies: true,
          replyCount: totalReplies(),
          showReplies: showReplies(),
          onShowReplies: () => setShowReplies(!showReplies()),
        } : undefined}
      />

      {/* Flat reply list with left border */}
      <Show when={hasReplies() && showReplies()}>
        <div class="ml-5 pl-4 border-l-2 border-[var(--nav-border)]">
          <For each={flat()}>
            {(reply) => (
              <CommentItem
                comment={reply}
                discussionChatId={props.discussionChatId}
                onReply={() => startReply(reply.id)}
                isReplying={replyTargetId() === reply.id}
              />
            )}
          </For>
        </div>
      </Show>

      {/* Reply composer */}
      <Show when={isReplying()}>
        <div class="ml-10 mb-3">
          <ReplyComposer
            onSubmit={handleSendReply}
            onCancel={cancelReply}
            isSending={props.isSending}
          />
        </div>
      </Show>
    </div>
  )
}
