import { useParams, useNavigate } from '@solidjs/router'
import { createMemo, createEffect, onCleanup, Show } from 'solid-js'
import { Timeline } from '@/components/timeline'
import { ChannelCard } from '@/components/channel'
import { Skeleton, ErrorState } from '@/components/ui'
import { useResolveChannel, useChannelInfo } from '@/lib/query/hooks/useChannels'
import { useMessages } from '@/lib/query/hooks/useTimeline'
import { openChannel, closeChannel } from '@/lib/telegram/openChats'
import { groupPostsByMediaGroup } from '@/lib/utils'
import { ChevronLeft } from 'lucide-solid'

/**
 * Channel page - Shows all posts from a single channel
 *
 * Supports two URL formats:
 * - /channel/:id - by numeric ID
 * - /@:username - by username
 *
 * Features a Twitter-style profile card with glassmorphism design
 * showing full channel info (description, stats, badges).
 */
function Channel() {
  const params = useParams()
  const navigate = useNavigate()

  // Resolve channel from ID or username param
  const idOrUsername = () => params.id ? parseInt(params.id, 10) : params.username
  const resolvedChannel = useResolveChannel(idOrUsername)
  const channelId = resolvedChannel.channelId

  const channelInfoQuery = useChannelInfo(channelId)
  const messagesQuery = useMessages(channelId)
  // Use full info if available, fallback to resolved channel
  const channel = createMemo(() =>
    channelInfoQuery.data ?? resolvedChannel.data
  )

  // Open channel for real-time updates when viewing it
  // This is MTProto requirement - openChat ensures we receive updates
  createEffect(() => {
    const id = channelId()
    if (!id) return

    // Open the channel
    openChannel(id).catch(() => {
      // Ignore errors - channel might be invalid
    })

    // Close when leaving the page
    onCleanup(() => {
      closeChannel(id).catch(() => {
        // Ignore cleanup errors
      })
    })
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

  return (
    <div class="min-h-full flex flex-col">
      {/* Back button */}
      <div class="px-4 pt-4">
        <button type="button" onClick={handleBack} class="pill">
          <ChevronLeft size={16} />
          Back
        </button>
      </div>

      {/* Error state */}
      <Show when={!channel() && resolvedChannel.isError}>
        <ErrorState
          variant="not-found"
          title="Channel not found"
          description="This channel may not exist or is unavailable."
          action={{
            label: 'Try Again',
            onClick: () => resolvedChannel.refetch(),
          }}
          secondaryAction={{
            label: 'Go Back',
            onClick: handleBack,
          }}
        />
      </Show>

      {/* Channel card */}
      <div class="px-4 py-4">
        <Show
          when={channel()}
          fallback={
            <Show when={!resolvedChannel.isError}>
              <div class="relative overflow-hidden rounded-3xl">
                {/* Banner */}
                <div class="h-28 bg-[var(--bg-tertiary)]" />
                {/* Content card */}
                <div class="relative glass-card -mt-8 mx-3 mb-3 p-4">
                  {/* Avatar row */}
                  <div class="flex items-end gap-4 -mt-14 mb-4">
                    <Skeleton class="w-20 h-20 rounded-full ring-4 ring-[var(--bg-primary)]" />
                    <div class="flex-1" />
                  </div>
                  {/* Content */}
                  <Skeleton class="h-6 w-40 mb-2" />
                  <Skeleton class="h-4 w-24 mb-4" />
                  <Skeleton class="h-4 w-full mb-1" />
                  <Skeleton class="h-4 w-2/3" />
                </div>
              </div>
            </Show>
          }
        >
          {(ch) => (
            <ChannelCard channel={ch()} />
          )}
        </Show>
      </div>

      {/* Posts */}
      <div class="flex-1">
        <Timeline
          items={groupPostsByMediaGroup(messagesQuery.data ?? [])}
          channels={channel() ? [channel()!] : []}
          isLoading={resolvedChannel.isLoading || resolvedChannel.isFetching || messagesQuery.isLoading}
          isLoadingMore={false}
          hasMore={false}
          onLoadMore={() => {}}
          scrollKey={`channel-${channelId()}`}
        />
      </div>
    </div>
  )
}
export default Channel
