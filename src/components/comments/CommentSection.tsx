import { For, Show } from 'solid-js'
import { CommentThread } from './CommentThread'
import { CommentComposer } from './CommentComposer'
import { CommentSkeleton, ErrorState } from '@/components/ui'
import { useComments, useSendComment } from '@/lib/query'
import { MessageCircle, MessageCircleOff } from 'lucide-solid'

interface CommentSectionProps {
  channelId: number
  messageId: number
}

/**
 * Comment section for a post
 *
 * Always visible with comment count, threaded comments, and composer.
 */
export function CommentSection(props: CommentSectionProps) {
  const commentsQuery = useComments(
    () => props.channelId,
    () => props.messageId,
    () => true // Always load comments
  )

  const sendMutation = useSendComment(
    () => props.channelId,
    () => props.messageId
  )

  const handleSendComment = (text: string, replyToId?: number) => {
    sendMutation.mutate({ text, replyToCommentId: replyToId })
  }

  const totalComments = () => commentsQuery.data?.totalCount ?? 0
  const isDisabled = () => commentsQuery.data?.disabled === true

  return (
    <div class="space-y-4">
      {/* Header with comment count */}
      <div class="flex items-center gap-2 text-sm text-secondary">
        <Show when={!isDisabled()} fallback={<MessageCircleOff size={20} />}>
          <MessageCircle size={20} />
        </Show>
        <span class="font-medium">
          <Show when={!isDisabled()} fallback="Comments unavailable">
            {totalComments()} {totalComments() === 1 ? 'comment' : 'comments'}
          </Show>
        </span>
      </div>

      {/* Comment composer - hidden when discussion is deleted */}
      <Show when={!isDisabled()}>
        <CommentComposer
          onSubmit={(text) => handleSendComment(text)}
          isSending={sendMutation.isPending}
        />
      </Show>

      {/* Loading state */}
      <Show when={commentsQuery.isLoading}>
        <div class="space-y-2">
          <CommentSkeleton />
          <CommentSkeleton depth={1} />
          <CommentSkeleton />
        </div>
      </Show>

      {/* Error state */}
      <Show when={commentsQuery.isError}>
        <ErrorState
          variant="error"
          title="Failed to load comments"
          description="Something went wrong while loading comments."
          action={{
            label: 'Try Again',
            onClick: () => commentsQuery.refetch(),
          }}
          compact
        />
      </Show>

      {/* Discussion deleted state */}
      <Show when={isDisabled()}>
        <ErrorState
          variant="empty"
          title="Comments unavailable"
          description="The discussion for this post was deleted."
          compact
        />
      </Show>

      {/* Empty state - only when discussion exists but no comments */}
      <Show when={!commentsQuery.isLoading && !commentsQuery.isError && !isDisabled() && totalComments() === 0}>
        <ErrorState
          variant="empty"
          title="No comments yet"
          description="Be the first to share your thoughts!"
          compact
        />
      </Show>

      {/* Comments list */}
      <Show when={commentsQuery.data && commentsQuery.data.comments.length > 0}>
        <div class="space-y-1">
          <For each={commentsQuery.data!.comments}>
            {(comment) => (
              <CommentThread
                comment={comment}
                discussionChatId={commentsQuery.data!.discussionChatId}
                onReply={handleSendComment}
                isSending={sendMutation.isPending}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
