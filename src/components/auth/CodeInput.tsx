import { createSignal, onMount, For } from 'solid-js'
import { ChevronLeft } from 'lucide-solid'

interface CodeInputProps {
  phone: string
  onSubmit: (code: string) => void
  onBack: () => void
  isLoading?: boolean
  error?: string
}

const CODE_LENGTH = 5

/**
 * Verification code input - Telegram native style
 */
export function CodeInput(props: CodeInputProps) {
  const [code, setCode] = createSignal<string[]>(Array(CODE_LENGTH).fill(''))
  let inputRefs: HTMLInputElement[] = []

  const handleInput = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1)

    const newCode = [...code()]
    newCode[index] = digit
    setCode(newCode)

    if (digit && index < CODE_LENGTH - 1) {
      inputRefs[index + 1]?.focus()
    }

    if (newCode.every((d) => d) && newCode.join('').length === CODE_LENGTH) {
      props.onSubmit(newCode.join(''))
    }
  }

  const handleKeyDown = (index: number, e: KeyboardEvent) => {
    if (e.key === 'Backspace' && !code()[index] && index > 0) {
      inputRefs[index - 1]?.focus()
    }
  }

  const handlePaste = (e: ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData?.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH)
    if (pasted) {
      const newCode = pasted.split('').concat(Array(CODE_LENGTH - pasted.length).fill(''))
      setCode(newCode)
      if (pasted.length === CODE_LENGTH) {
        props.onSubmit(pasted)
      } else {
        inputRefs[pasted.length]?.focus()
      }
    }
  }

  onMount(() => {
    inputRefs[0]?.focus()
  })

  return (
    <div class="flex flex-col items-center">
      {/* Back button */}
      <button 
        type="button" 
        onClick={props.onBack} 
        class="
          self-start flex items-center gap-1 
          text-[#0088cc] text-[15px] font-medium
          active:opacity-70 transition-opacity mb-8
        "
      >
        <ChevronLeft size={20} />
        Back
      </button>

      {/* Icon */}
      <div class="w-20 h-20 rounded-full bg-[#0088cc]/10 flex items-center justify-center mb-5">
        <svg class="w-10 h-10 text-[#0088cc]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
        </svg>
      </div>

      {/* Header */}
      <h1 class="text-[24px] font-semibold text-primary text-center mb-2">
        Enter Code
      </h1>
      <p class="text-[15px] text-secondary text-center mb-8">
        We sent a code to <span class="text-primary font-medium">{props.phone}</span>
      </p>

      {/* Code input boxes */}
      <div class="flex justify-center gap-3 mb-4" role="group" aria-label="Verification code">
        <For each={Array(CODE_LENGTH).fill(0)}>
          {(_, index) => (
            <input
              ref={(el) => (inputRefs[index()] = el)}
              type="text"
              inputMode="numeric"
              maxLength={1}
              autocomplete="one-time-code"
              aria-label={`Digit ${index() + 1} of ${CODE_LENGTH}`}
              value={code()[index()]}
              onInput={(e) => handleInput(index(), e.currentTarget.value)}
              onKeyDown={(e) => handleKeyDown(index(), e)}
              onPaste={handlePaste}
              class={`
                w-[52px] h-[60px] text-center text-[24px] font-semibold
                bg-[var(--pill-bg)] text-primary rounded-xl
                border-2 transition-all duration-200
                focus:outline-none focus:border-[var(--accent)] focus:bg-[var(--color-bg)]
                ${props.error ? 'border-[var(--danger)]' : 'border-transparent'}
              `}
            />
          )}
        </For>
      </div>

      {/* Error message */}
      {props.error && (
        <p class="text-[var(--danger)] text-[13px] text-center mb-4">
          {props.error}
        </p>
      )}

      {/* Loading indicator */}
      {props.isLoading && (
        <div class="flex items-center gap-2 text-secondary text-[14px] mb-4">
          <div class="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          Verifying...
        </div>
      )}

      {/* Help text */}
      <p class="text-[14px] text-tertiary text-center">
        Didn't receive the code?{' '}
        <button
          type="button"
          class="text-[#0088cc] font-medium active:opacity-70"
          onClick={props.onBack}
        >
          Try again
        </button>
      </p>
    </div>
  )
}
