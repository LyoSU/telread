import { useParams, useNavigate } from '@solidjs/router'
import { Show, createMemo, createEffect, onCleanup } from 'solid-js'
import { Motion } from 'solid-motionone'
import { ChannelAvatar, PostSkeleton, ErrorState } from '@/components/ui'
import { PostContent, PostMedia, PostActions, MediaGallery } from '@/components/post'
import { CommentSection } from '@/components/comments'
import { usePost } from '@/lib/query/hooks/usePost'
import { useResolveChannel, useChannelInfo } from '@/lib/query/hooks/useChannels'
import { postsState } from '@/lib/store/posts'
import { openChannel, closeChannel } from '@/lib/telegram/openChats'
import { ChevronLeft, CornerDownRight } from 'lucide-solid'
import type { Message } from '@/lib/telegram/messages'

/**
 * Post detail page with full content and comments
 *
 * Supports two URL formats:
 * - /post/:channelId/:messageId - by numeric ID
 * - /c/:username/:messageId - by username
 */
function Post() {
  const params = useParams()
  const navigate = useNavigate()

  // Resolve channel from ID or username param
  const idOrUsername = createMemo(() => {
    if (params.channelId) return parseInt(params.channelId, 10)
    if (params.username) return params.username
    return undefined
  })

  const resolvedChannel = useResolveChannel(idOrUsername)
  const channelId = resolvedChannel.channelId
  const messageId = () => parseInt(params.messageId ?? '0', 10)

  const postQuery = usePost(channelId, messageId)
  const channelInfoQuery = useChannelInfo(channelId)

  // Use resolved channel or full info
  const channel = createMemo(() => channelInfoQuery.data ?? resolvedChannel.data)

  // Open channel for real-time updates (new comments, reactions)
  createEffect(() => {
    const id = channelId()
    if (!id) return

    openChannel(id).catch(() => {})

    onCleanup(() => {
      closeChannel(id).catch(() => {})
    })
  })

  // Find all posts in the same media group
  const groupedPosts = createMemo(() => {
    const post = postQuery.data
    if (!post?.groupedId) return null

    // Find all posts with the same groupedId from the store
    const groupIdStr = post.groupedId.toString()
    const allPosts = Object.values(postsState.byId).filter(
      (p): p is Message => p?.groupedId?.toString() === groupIdStr
    )

    if (allPosts.length <= 1) return null

    // Sort by message ID
    return allPosts.sort((a, b) => a.id - b.id)
  })

  // Media items for gallery
  const mediaItems = createMemo(() => {
    const posts = groupedPosts()
    if (!posts) return null

    return posts
      .filter((p): p is Message & { media: NonNullable<Message['media']> } => p.media != null)
      .map((p) => ({
        channelId: p.channelId,
        messageId: p.id,
        media: p.media,
      }))
  })

  const handleBack = () => {
    // Check if we came from within the app (same origin)
    const referrer = document.referrer
    const isSameOrigin = referrer && new URL(referrer).origin === window.location.origin

    if (isSameOrigin) {
      navigate(-1)
    } else {
      // Direct link or external referrer - go to home
      navigate('/')
    }
  }

  const handleChannelClick = () => {
    const ch = channel()
    if (ch?.username) {
      navigate(`/c/${ch.username}`)
    } else if (channelId()) {
      navigate(`/channel/${channelId()}`)
    }
  }

  const hasData = () => postQuery.data && channel()
  const isLoading = () => !hasData() && (postQuery.isLoading || resolvedChannel.isLoading || resolvedChannel.isFetching)
  const isError = () => !hasData() && (postQuery.isError || resolvedChannel.isError)

  return (
    <div class="min-h-full pb-24">
      {/* Back button */}
      <div class="sticky top-0 z-30 px-4 pt-4">
        <button
          type="button"
          onClick={handleBack}
          class="pill"
        >
          <ChevronLeft size={16} />
          Back
        </button>
      </div>

      {/* Loading - only when no data yet */}
      <Show when={isLoading()}>
        <PostSkeleton />
      </Show>

      {/* Error - only when no data and error occurred */}
      <Show when={isError()}>
        <ErrorState
          variant="not-found"
          title="Post not found"
          description="This post may have been deleted or the channel is unavailable."
          action={{
            label: 'Try Again',
            onClick: () => {
              postQuery.refetch()
              resolvedChannel.refetch()
            },
          }}
          secondaryAction={{
            label: 'Go Back',
            onClick: handleBack,
          }}
        />
      </Show>

      {/* Post content */}
      <Show when={hasData()}>
        <Motion.article
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          class="post"
        >
          {/* Forward indicator */}
          <Show when={postQuery.data?.forward}>
            {(forward) => (
              <button
                type="button"
                class="flex items-center gap-2 px-4 pt-3 pb-1 text-sm text-tertiary hover:text-accent transition-colors w-full text-left"
                onClick={() => {
                  const fwd = forward()
                  if (fwd.senderId) {
                    navigate(`/channel/${fwd.senderId}`)
                  }
                }}
              >
                <CornerDownRight size={16} class="flex-shrink-0" />
                <span class="truncate">
                  Forwarded from{' '}
                  <span class="text-accent font-medium">{forward().senderName}</span>
                  <Show when={forward().signature}>
                    {(sig) => <span class="text-tertiary"> ({sig()})</span>}
                  </Show>
                </span>
              </button>
            )}
          </Show>

          {/* Header */}
          <div class="post-header cursor-pointer" onClick={handleChannelClick}>
            <ChannelAvatar channelId={channelId()} name={channel()?.title ?? ''} size="md" />
            <div class="flex-1 min-w-0 overflow-hidden">
              <p class="font-semibold text-primary hover:underline truncate max-w-full">
                {channel()?.title}
              </p>
              <p class="text-sm text-tertiary">
                {postQuery.data ? formatDate(postQuery.data.date) : ''}
              </p>
            </div>
          </div>

          {/* Text content - full, no truncation */}
          <Show when={postQuery.data?.text}>
            {(text) => (
              <div class="post-content">
                <PostContent
                  text={text()}
                  entities={postQuery.data?.entities}
                />
              </div>
            )}
          </Show>

          {/* Media - gallery for groups, single for regular posts */}
          <Show
            when={mediaItems()}
            fallback={
              <Show when={postQuery.data?.media}>
                {(media) => (
                  <div class="post-media">
                    <PostMedia
                      channelId={channelId()}
                      messageId={messageId()}
                      media={media()}
                      class="mx-4 rounded-2xl overflow-hidden"
                    />
                  </div>
                )}
              </Show>
            }
          >
            {(items) => (
              <div class="post-media">
                <MediaGallery items={items()} class="mx-4" />
              </div>
            )}
          </Show>

          {/* Actions */}
          <div class="post-actions">
            <PostActions
              channelId={channelId()}
              messageId={messageId()}
              channelTitle={channel()?.title ?? ''}
              preview={postQuery.data?.text}
              views={postQuery.data?.views}
              replies={postQuery.data?.replies}
              reactions={postQuery.data?.reactions}
            />
          </div>
        </Motion.article>

        {/* Comments section - only if channel has comments enabled */}
        <Show when={postQuery.data?.replies !== undefined}>
          <div class="px-4 pt-4 pb-4">
            <CommentSection
              channelId={channelId()}
              messageId={messageId()}
            />
          </div>
        </Show>
      </Show>
    </div>
  )
}

function formatDate(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default Post
