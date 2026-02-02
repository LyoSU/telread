import { onMount } from 'solid-js'
import type { JSX } from 'solid-js'

export interface CommentInputRef {
  resetHeight: () => void
}

interface CommentInputProps {
  value: string
  onInput: (value: string) => void
  onSubmit: () => void
  placeholder?: string
  disabled?: boolean
  autofocus?: boolean
  maxHeight?: number
  onEscape?: () => void
  ref?: (ref: CommentInputRef) => void
}

/**
 * Reusable textarea input for comments/replies
 *
 * Features:
 * - Auto-resize based on content
 * - Ctrl/Cmd+Enter to submit
 * - Escape key handler (optional)
 */
export function CommentInput(props: CommentInputProps) {
  let textareaRef: HTMLTextAreaElement | undefined

  const maxHeight = () => props.maxHeight ?? 200

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      props.onSubmit()
    }
    if (e.key === 'Escape' && props.onEscape) {
      props.onEscape()
    }
  }

  const handleInput: JSX.EventHandler<HTMLTextAreaElement, InputEvent> = (e) => {
    const target = e.currentTarget
    props.onInput(target.value)
    target.style.height = 'auto'
    target.style.height = `${Math.min(target.scrollHeight, maxHeight())}px`
  }

  const resetHeight = () => {
    if (textareaRef) {
      textareaRef.style.height = 'auto'
    }
  }

  onMount(() => {
    if (props.autofocus) {
      textareaRef?.focus()
    }
    // Expose ref with resetHeight method
    props.ref?.({ resetHeight })
  })

  return (
    <textarea
      ref={(el) => {
        textareaRef = el
      }}
      value={props.value}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      placeholder={props.placeholder}
      disabled={props.disabled}
      rows={1}
      class="w-full bg-transparent resize-none outline-none text-primary text-sm min-h-[24px] placeholder:text-tertiary"
      style={{ "max-height": `${maxHeight()}px` }}
    />
  )
}
