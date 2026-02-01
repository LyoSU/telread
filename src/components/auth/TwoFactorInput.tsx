import { createSignal, Show } from 'solid-js'
import { ChevronLeft, Loader2 } from 'lucide-solid'

interface TwoFactorInputProps {
  hint?: string
  onSubmit: (password: string) => void
  onBack: () => void
  isLoading?: boolean
  error?: string
}

/**
 * Two-factor authentication - Telegram native style
 */
export function TwoFactorInput(props: TwoFactorInputProps) {
  const [password, setPassword] = createSignal('')
  const [showPassword, setShowPassword] = createSignal(false)

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    if (password()) {
      props.onSubmit(password())
    }
  }

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
          <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
      </div>

      {/* Header */}
      <h1 class="text-[24px] font-semibold text-primary text-center mb-2">
        Two-Factor Authentication
      </h1>
      <p class="text-[15px] text-secondary text-center mb-6">
        Your account is protected with an additional password
      </p>

      {/* Form */}
      <form onSubmit={handleSubmit} class="w-full space-y-4">
        {/* Password input */}
        <div>
          <label class="block text-[13px] text-secondary mb-2 pl-1">
            Password
          </label>
          <div class="relative">
            <input
              type={showPassword() ? 'text' : 'password'}
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              placeholder="Enter your password"
              autofocus
              class={`
                w-full h-[52px] px-4 pr-12 rounded-xl text-[17px]
                bg-[var(--pill-bg)] text-primary
                placeholder:text-tertiary
                border-2 transition-all duration-200
                focus:outline-none
                ${props.error 
                  ? 'border-[var(--danger)] focus:border-[var(--danger)]' 
                  : 'border-transparent focus:border-[var(--accent)] focus:bg-[var(--color-bg)]'
                }
              `}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword())}
              class="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-tertiary active:opacity-70"
            >
              <Show 
                when={showPassword()} 
                fallback={
                  <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                }
              >
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
              </Show>
            </button>
          </div>
        </div>

        {/* Hint */}
        <Show when={props.hint}>
          <p class="text-[13px] text-tertiary pl-1">
            Hint: <span class="text-secondary">{props.hint}</span>
          </p>
        </Show>

        {/* Error */}
        {props.error && (
          <p class="text-[var(--danger)] text-[13px] text-center">
            {props.error}
          </p>
        )}

        {/* Submit button */}
        <button
          type="submit"
          disabled={!password() || props.isLoading}
          class={`
            w-full h-[52px] rounded-xl font-semibold text-[17px]
            transition-all duration-200 flex items-center justify-center gap-2
            ${password() && !props.isLoading
              ? 'bg-[#0088cc] text-white active:scale-[0.98] hover:bg-[#0077b5]'
              : 'bg-[var(--pill-bg)] text-tertiary cursor-not-allowed'
            }
          `}
        >
          {props.isLoading ? (
            <Loader2 size={20} class="animate-spin" />
          ) : (
            'Continue'
          )}
        </button>
      </form>
    </div>
  )
}
