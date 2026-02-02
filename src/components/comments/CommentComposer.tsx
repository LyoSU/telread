import { createSignal, Show } from 'solid-js'
import { GlassButton, UserAvatar } from '@/components/ui'
import { authStore } from '@/lib/store'
import { CommentInput, type CommentInputRef } from './CommentInput'

interface CommentComposerProps {
  onSubmit: (text: string) => void
  isSending?: boolean
}

/**
 * Comment composer - mobile-friendly
 *
 * Clean input with user avatar and expanding textarea.
 */
export function CommentComposer(props: CommentComposerProps) {
  const [text, setText] = createSignal('')
  let inputRef: CommentInputRef | undefined

  const handleSubmit = () => {
    const content = text().trim()
    if (!content || props.isSending) return

    props.onSubmit(content)
    setText('')

    // Reset textarea height
    inputRef?.resetHeight()
  }

  return (
    <div class="flex gap-3 items-start">
      <UserAvatar
        userId={authStore.user?.id ?? 0}
        name={authStore.user?.displayName ?? 'You'}
        size="md"
      />

      <div class="flex-1 glass rounded-2xl px-4 py-3">
        <CommentInput
          ref={(ref) => { inputRef = ref }}
          value={text()}
          onInput={setText}
          onSubmit={handleSubmit}
          placeholder="Add comment..."
          maxHeight={200}
        />

        <Show when={text().trim().length > 0}>
          <div class="flex items-center justify-end mt-3 pt-3 border-t border-[var(--glass-border)]">
            <GlassButton
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={!text().trim() || props.isSending}
              loading={props.isSending}
            >
              Send
            </GlassButton>
          </div>
        </Show>
      </div>
    </div>
  )
}
