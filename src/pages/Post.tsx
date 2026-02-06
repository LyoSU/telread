import { useParams, useNavigate } from '@solidjs/router'
import { Show, createMemo, createEffect, onCleanup, untrack } from 'solid-js'
import { Motion } from 'solid-motionone'
import { ChannelAvatar, PostSkeleton, ErrorState } from '@/components/ui'
import { PostContent, PostMedia, PostActions, MediaGallery } from '@/components/post'
import { CommentSection } from '@/components/comments'
import { usePost } from '@/lib/query/hooks/usePost'
import { useResolveChannel, useChannelInfo } from '@/lib/query/hooks/useChannels'
import { postsState } from '@/lib/store/posts'
import { getChannel, getChannelByUsername } from '@/lib/store/channels'
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

  const parsedChannelId = () => {
    const n = parseInt(params.channelId, 10)
    return Number.isFinite(n) ? n : 0
  }
  const parsedMessageId = () => {
    const n = parseInt(params.messageId, 10)
    return Number.isFinite(n) ? n : 0
  }

  // Quick resolve from store first (instant if channel is known)
  const storeChannel = createMemo(() => {
    if (params.channelId && parsedChannelId()) {
      return getChannel(parsedChannelId())
    }
    if (params.username) {
      return getChannelByUsername(params.username)
    }
    return undefined
  })

  // Only use query as fallback if not in store
  const idOrUsername = createMemo(() => {
    if (storeChannel()) return undefined
    if (params.channelId && parsedChannelId()) return parsedChannelId()
    if (params.username) return params.username
    return undefined
  })

  const resolvedChannel = useResolveChannel(idOrUsername)

  // Channel ID - prefer raw param (instant), then store, then query
  // For /post/:channelId routes, use param directly to avoid waterfall
  const channelId = createMemo(() => {
    if (params.channelId && parsedChannelId()) return parsedChannelId()
    const fromStore = storeChannel()
    if (fromStore) return fromStore.id
    return resolvedChannel.channelId()
  })
  const messageId = parsedMessageId

  const postQuery = usePost(channelId, messageId)
  const channelInfoQuery = useChannelInfo(channelId)

  // Use store channel, resolved channel, or full info
  const channel = createMemo(() => storeChannel() ?? channelInfoQuery.data ?? resolvedChannel.data)

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
  // Only re-runs when the current post's groupedId changes (not on every store mutation)
  const groupedPosts = createMemo(() => {
    const post = postQuery.data
    if (!post?.groupedId) return null

    const groupIdStr = post.groupedId.toString()

    // untrack: avoid subscribing to every post in the store —
    // this is a one-shot lookup triggered only by groupedId change
    const allPosts = untrack(() =>
      Object.values(postsState.byId).filter(
        (p): p is Message => p?.groupedId?.toString() === groupIdStr
      )
    )

    if (allPosts.length <= 1) return null

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
    try {
      const referrer = document.referrer
      if (referrer && new URL(referrer).origin === window.location.origin) {
        navigate(-1)
        return
      }
    } catch {
      // Malformed referrer — fall through to home
    }
    navigate('/')
  }

  const handleChannelClick = () => {
    const ch = channel()
    if (ch?.username) {
      navigate(`/c/${ch.username}`)
    } else if (channelId()) {
      navigate(`/channel/${channelId()}`)
    }
  }

  // Show content as soon as post data is available — don't wait for channel
  const hasPost = () => !!postQuery.data
  const isLoading = () => {
    if (hasPost()) return false
    if (params.channelId || storeChannel()) return postQuery.isLoading
    return postQuery.isLoading || resolvedChannel.isLoading || resolvedChannel.isFetching
  }
  const isError = () => {
    if (hasPost()) return false
    if (postQuery.isError) return true
    if (!params.channelId && !storeChannel() && resolvedChannel.isError) return true
    return false
  }

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
      <Show when={hasPost()}>
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

          {/* Header - shows skeleton while channel info loads */}
          <Show
            when={channel()}
            fallback={
              <div class="post-header">
                <div class="w-10 h-10 rounded-full bg-[var(--glass-bg)] animate-pulse flex-shrink-0" />
                <div class="flex-1 min-w-0 overflow-hidden">
                  <div class="h-4 w-24 rounded bg-[var(--glass-bg)] animate-pulse" />
                  <p class="text-sm text-tertiary mt-1">
                    {postQuery.data ? formatDate(postQuery.data.date) : ''}
                  </p>
                </div>
              </div>
            }
          >
            {(ch) => (
              <div class="post-header cursor-pointer" onClick={handleChannelClick}>
                <ChannelAvatar channelId={channelId()} name={ch().title ?? ''} size="md" />
                <div class="flex-1 min-w-0 overflow-hidden">
                  <p class="font-semibold text-primary hover:underline truncate max-w-full">
                    {ch().title}
                  </p>
                  <p class="text-sm text-tertiary">
                    {postQuery.data ? formatDate(postQuery.data.date) : ''}
                  </p>
                </div>
              </div>
            )}
          </Show>

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
          <Show when={channelId() !== 0}>
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
          </Show>
        </Motion.article>

        {/* Comments section - only if channel has comments enabled */}
        <Show when={channelId() !== 0 && postQuery.data?.replies !== undefined}>
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
