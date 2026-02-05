import { createSignal, Show } from 'solid-js'
import { GlassButton } from '@/components/ui'
import { CommentInput } from './CommentInput'

interface ReplyComposerProps {
  onSubmit: (text: string) => void
  onCancel: () => void
  isSending?: boolean
}

/**
 * Inline reply composer for nested replies
 */
export function ReplyComposer(props: ReplyComposerProps) {
  const [text, setText] = createSignal('')

  const handleSubmit = () => {
    const content = text().trim()
    if (!content || props.isSending) return
    props.onSubmit(content)
  }

  return (
    <div class="glass rounded-2xl px-4 py-3">
      <CommentInput
        value={text()}
        onInput={setText}
        onSubmit={handleSubmit}
        onEscape={props.onCancel}
        autofocus
        maxHeight={120}
      />

      <Show when={text().length > 0}>
        <div class="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-[var(--glass-border)]">
          <button
            type="button"
            onClick={props.onCancel}
            class="px-3 py-1.5 rounded-full text-xs font-medium text-tertiary hover:text-primary transition-colors"
          >
            Cancel
          </button>
          <GlassButton
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={!text().trim() || props.isSending}
            loading={props.isSending}
          >
            Reply
          </GlassButton>
        </div>
      </Show>
    </div>
  )
}
