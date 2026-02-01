import { createSignal } from 'solid-js'
import iconSvg from '/icons/icon.svg'
import { Loader2 } from 'lucide-solid'

interface PhoneInputProps {
  onSubmit: (phone: string) => void
  onSwitchToQR: () => void
  isLoading?: boolean
  error?: string
}

/**
 * Phone number input step - Telegram native style
 */
export function PhoneInput(props: PhoneInputProps) {
  const [phone, setPhone] = createSignal('')

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    const cleaned = phone().replace(/\D/g, '')
    if (cleaned.length >= 10) {
      props.onSubmit(cleaned.startsWith('+') ? cleaned : `+${cleaned}`)
    }
  }

  const formatPhone = (value: string) => {
    let cleaned = value.replace(/[^\d+]/g, '')
    if (!cleaned.startsWith('+') && cleaned.length > 0) {
      cleaned = '+' + cleaned
    }
    return cleaned
  }

  const isValid = () => phone().replace(/\D/g, '').length >= 10

  return (
    <div class="flex flex-col items-center">
      {/* Logo */}
      <img 
        src={iconSvg} 
        alt="TelRead" 
        class="w-24 h-24 mb-5"
      />

      {/* Header */}
      <h1 class="text-[28px] font-semibold text-primary text-center mb-2">
        TelRead
      </h1>
      
      {/* App description */}
      <p class="text-[15px] text-secondary text-center mb-1">
        Read Telegram channels distraction-free
      </p>
      <p class="text-[13px] text-tertiary text-center mb-6">
        A clean reader for your favorite channels
      </p>

      {/* Telegram auth badge */}
      <div class="flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#0088cc]/10 mb-6">
        <svg class="w-5 h-5 text-[#0088cc]" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
        </svg>
        <span class="text-[13px] font-medium text-[#0088cc]">Sign in with Telegram</span>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} class="w-full space-y-4">
        {/* Phone input */}
        <div>
          <label class="block text-[13px] text-secondary mb-2 pl-1">
            Phone number
          </label>
          <input
            type="tel"
            value={phone()}
            onInput={(e) => setPhone(formatPhone(e.currentTarget.value))}
            placeholder="+1 234 567 8900"
            autofocus
            class={`
              w-full h-[52px] px-4 rounded-xl text-[17px]
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
        </div>

        {/* Error */}
        {props.error && (
          <p class="text-[var(--danger)] text-[13px] text-center">
            {props.error}
          </p>
        )}

        {/* Submit button */}
        <button
          type="submit"
          disabled={!isValid() || props.isLoading}
          class={`
            w-full h-[52px] rounded-xl font-semibold text-[17px]
            transition-all duration-200 flex items-center justify-center gap-2
            ${isValid() && !props.isLoading
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

      {/* Divider */}
      <div class="relative w-full my-5">
        <div class="absolute inset-0 flex items-center">
          <div class="w-full border-t border-[var(--nav-border)]" />
        </div>
        <div class="relative flex justify-center">
          <span class="px-4 bg-[var(--color-bg)] text-tertiary text-[13px]">or</span>
        </div>
      </div>

      {/* QR Login */}
      <button
        type="button"
        onClick={props.onSwitchToQR}
        class="
          w-full h-[52px] rounded-xl font-medium text-[15px]
          bg-[var(--pill-bg)] text-primary
          transition-all duration-200
          active:scale-[0.98] hover:bg-[var(--pill-bg-hover)]
          flex items-center justify-center gap-2
        "
      >
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h2M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
        </svg>
        Log in with QR Code
      </button>

      {/* Security info */}
      <div class="mt-6 p-4 rounded-xl bg-[var(--pill-bg)]/50">
        <div class="flex items-start gap-3">
          <svg class="w-5 h-5 text-[var(--success)] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <p class="text-[13px] text-secondary leading-relaxed">
            Your data is sent directly to Telegram via secure MTProto protocol. We never store your password.
          </p>
        </div>
      </div>
    </div>
  )
}
