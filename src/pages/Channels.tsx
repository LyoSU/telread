import { For, Show, createSignal } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { GlassCard, GlassButton, GlassInput, ChannelAvatar, Skeleton, InlineError } from '@/components/ui'
import { useChannels, useJoinChannel } from '@/lib/query/hooks/useChannels'
import { formatCount } from '@/lib/utils'
import { Plus, Layers, ChevronRight } from 'lucide-solid'

/**
 * Channels list page
 */
function Channels() {
  const navigate = useNavigate()
  const [joinInput, setJoinInput] = createSignal('')
  const [showJoinModal, setShowJoinModal] = createSignal(false)

  const channelsQuery = useChannels()
  const joinMutation = useJoinChannel()

  const handleJoin = async () => {
    const input = joinInput().trim()
    if (!input) return

    const result = await joinMutation.mutateAsync(input)
    if (result) {
      setJoinInput('')
      setShowJoinModal(false)
    }
  }

  const handleChannelClick = (channelId: number) => {
    navigate(`/channel/${channelId}`)
  }

  return (
    <div class="p-4 space-y-4 min-h-full pb-24">
      {/* Header */}
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-semibold text-primary">
          Channels
        </h1>
        <GlassButton
          variant="primary"
          size="sm"
          onClick={() => setShowJoinModal(true)}
        >
          <Plus size={16} />
          Add Channel
        </GlassButton>
      </div>

      {/* Join channel modal */}
      <Show when={showJoinModal()}>
        <GlassCard class="p-4 space-y-4">
          <h3 class="font-semibold text-primary">Join a Channel</h3>
          <GlassInput
            value={joinInput()}
            onInput={setJoinInput}
            placeholder="@username or t.me/username"
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          />
          <div class="flex gap-2 justify-end">
            <GlassButton
              variant="ghost"
              size="sm"
              onClick={() => setShowJoinModal(false)}
            >
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              size="sm"
              onClick={handleJoin}
              loading={joinMutation.isPending}
              disabled={!joinInput().trim()}
            >
              Join
            </GlassButton>
          </div>
          <Show when={joinMutation.isError}>
            <InlineError message="Failed to join channel. Check the username and try again." />
          </Show>
        </GlassCard>
      </Show>

      {/* Loading */}
      <Show when={channelsQuery.isLoading}>
        <div class="space-y-3">
          <For each={[1, 2, 3, 4, 5]}>
            {() => (
              <GlassCard class="p-4">
                <div class="flex items-center gap-3">
                  <Skeleton rounded="full" width="48px" height="48px" />
                  <div class="flex-1 space-y-2">
                    <Skeleton width="60%" height="1rem" />
                    <Skeleton width="40%" height="0.75rem" />
                  </div>
                </div>
              </GlassCard>
            )}
          </For>
        </div>
      </Show>

      {/* Empty state */}
      <Show when={!channelsQuery.isLoading && channelsQuery.data?.length === 0}>
        <div class="text-center py-12">
          <div class="w-16 h-16 rounded-2xl bg-[var(--accent)]/15 flex items-center justify-center mx-auto mb-4">
            <Layers size={32} class="text-accent" />
          </div>
          <h3 class="text-lg font-semibold text-primary mb-1">No channels yet</h3>
          <p class="text-secondary text-sm mb-4">
            Subscribe to Telegram channels to see their posts
          </p>
          <GlassButton
            variant="primary"
            onClick={() => setShowJoinModal(true)}
          >
            Add Your First Channel
          </GlassButton>
        </div>
      </Show>

      {/* Channels list */}
      <Show when={channelsQuery.data && channelsQuery.data.length > 0}>
        <div class="space-y-3">
          <For each={channelsQuery.data}>
            {(channel) => (
              <GlassCard
                class="p-4 cursor-pointer"
                onClick={() => handleChannelClick(channel.id)}
                hover
              >
                <div class="flex items-center gap-3">
                  <ChannelAvatar
                    channelId={channel.id}
                    name={channel.title}
                    size="lg"
                  />
                  <div class="flex-1 min-w-0">
                    <p class="font-semibold text-primary truncate">
                      {channel.title}
                    </p>
                    <Show when={channel.username}>
                      <p class="text-sm text-secondary truncate">
                        @{channel.username}
                      </p>
                    </Show>
                    <Show when={channel.participantsCount}>
                      {(count) => (
                        <p class="text-xs text-tertiary mt-1">
                          {formatCount(count())} subscribers
                        </p>
                      )}
                    </Show>
                  </div>
                  <ChevronRight size={20} class="text-tertiary flex-shrink-0" />
                </div>
              </GlassCard>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

export default Channels
