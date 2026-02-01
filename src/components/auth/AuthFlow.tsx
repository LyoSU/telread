import { createSignal, Match, Switch } from 'solid-js'
import iconSvg from '/icons/icon.svg'
import { Motion, Presence } from 'solid-motionone'
import { PhoneInput } from './PhoneInput'
import { CodeInput } from './CodeInput'
import { TwoFactorInput } from './TwoFactorInput'
import { QRCodeLogin } from './QRCodeLogin'
import {
  startPhoneAuth,
  submitCode,
  submit2FA,
  startQRAuth,
  stopQRAuth,
  type AuthState,
} from '@/lib/telegram'

interface AuthFlowProps {
  onSuccess: () => void
}

/**
 * Complete authentication flow component
 *
 * Handles all steps of Telegram authentication:
 * - Phone number entry
 * - Verification code
 * - 2FA password (if enabled)
 * - QR code login (alternative)
 */
export function AuthFlow(props: AuthFlowProps) {
  const [state, setState] = createSignal<AuthState>({ step: 'phone' })
  const [isLoading, setIsLoading] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)

  const callbacks = {
    onStateChange: (newState: AuthState) => {
      setIsLoading(false)

      if (newState.step === 'error') {
        setError(newState.message)
        return
      }

      setError(undefined)
      setState(newState)

      if (newState.step === 'done') {
        props.onSuccess()
      }
    },
  }

  const handlePhoneSubmit = async (phone: string) => {
    setIsLoading(true)
    setError(undefined)
    await startPhoneAuth(phone, callbacks)
  }

  const handleCodeSubmit = async (code: string) => {
    const currentState = state()
    if (currentState.step !== 'code') return

    setIsLoading(true)
    setError(undefined)
    await submitCode(
      currentState.phone,
      code,
      currentState.phoneCodeHash,
      callbacks
    )
  }

  const handle2FASubmit = async (password: string) => {
    setIsLoading(true)
    setError(undefined)
    await submit2FA(password, callbacks)
  }

  const handleQRStart = async () => {
    setIsLoading(true)
    setError(undefined)
    await startQRAuth(callbacks)
  }

  const handleBack = () => {
    stopQRAuth()
    setError(undefined)
    setState({ step: 'phone' })
  }

  const displayStep = () => state().step

  return (
    <div class="min-h-[100dvh] bg-[var(--color-bg)] flex">
      {/* Left side - Brand & Info (desktop only) */}
      <div 
        class="
          hidden lg:flex flex-col justify-between
          w-[45%] p-12 
          bg-gradient-to-br from-[#0088cc]/10 via-[var(--color-bg)] to-[var(--accent)]/5
          border-r border-[var(--nav-border)]
        "
      >
        {/* Top - Logo */}
        <div>
          <div class="flex items-center gap-3">
            <img src={iconSvg} alt="TelRead" class="w-10 h-10 rounded-xl" />
            <span class="text-xl font-semibold text-primary">TelRead</span>
          </div>
        </div>

        {/* Middle - Main pitch */}
        <div class="space-y-8">
          <div class="space-y-4">
            <h1 class="text-4xl font-bold text-primary leading-tight">
              A better way to read<br />
              <span class="text-[#0088cc]">Telegram channels</span>
            </h1>
            <p class="text-lg text-secondary max-w-md">
              Clean, distraction-free reading experience for your favorite channels. 
              No chats, no noise — just content.
            </p>
          </div>

          {/* Features */}
          <div class="space-y-4">
            <Feature 
              icon="reader" 
              title="Reader-first design" 
              desc="Optimized for consuming long-form content from channels"
            />
            <Feature 
              icon="lock" 
              title="Direct to Telegram" 
              desc="MTProto protocol — your data goes straight to Telegram, not our servers"
            />
            <Feature 
              icon="bolt" 
              title="Fast & lightweight" 
              desc="No bloat, no tracking, works offline"
            />
          </div>
        </div>

        {/* Bottom - Trust indicators */}
        <div class="flex items-center gap-6 text-sm text-tertiary">
          <span>Official Telegram API</span>
          <span class="text-[var(--nav-border)]">•</span>
          <span>MTProto 2.0</span>
        </div>
      </div>

      {/* Right side - Auth form (full screen on mobile) */}
      <div class="flex-1 flex flex-col min-h-[100dvh]">
        {/* Form container - centered vertically */}
        <div class="flex-1 flex items-center justify-center px-6 py-8 lg:p-12 safe-top safe-bottom">
          <div class="w-full max-w-[340px]">
            <Presence exitBeforeEnter>
              <Switch>
                <Match when={displayStep() === 'phone'}>
                  <Motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.25, easing: [0.25, 0.46, 0.45, 0.94] }}
                  >
                    <PhoneInput
                      onSubmit={handlePhoneSubmit}
                      onSwitchToQR={handleQRStart}
                      isLoading={isLoading()}
                      error={error()}
                    />
                  </Motion.div>
                </Match>

                <Match when={displayStep() === 'code'}>
                  <Motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.25, easing: [0.25, 0.46, 0.45, 0.94] }}
                  >
                    <CodeInput
                      phone={(state() as { step: 'code'; phone: string }).phone}
                      onSubmit={handleCodeSubmit}
                      onBack={handleBack}
                      isLoading={isLoading()}
                      error={error()}
                    />
                  </Motion.div>
                </Match>

                <Match when={displayStep() === '2fa'}>
                  <Motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.25, easing: [0.25, 0.46, 0.45, 0.94] }}
                  >
                    <TwoFactorInput
                      hint={(state() as { step: '2fa'; hint?: string }).hint}
                      onSubmit={handle2FASubmit}
                      onBack={handleBack}
                      isLoading={isLoading()}
                      error={error()}
                    />
                  </Motion.div>
                </Match>

                <Match when={displayStep() === 'qr'}>
                  <Motion.div
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.25, easing: [0.25, 0.46, 0.45, 0.94] }}
                  >
                    <QRCodeLogin
                      qrUrl={(state() as { step: 'qr'; url: string }).url}
                      onBack={handleBack}
                      isLoading={isLoading()}
                      error={error()}
                    />
                  </Motion.div>
                </Match>
              </Switch>
            </Presence>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Feature item for the left panel */
function Feature(props: { icon: string; title: string; desc: string }) {
  const iconMap: Record<string, string> = {
    reader: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
    lock: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
    bolt: 'M13 10V3L4 14h7v7l9-11h-7z',
  }
  
  return (
    <div class="flex gap-4">
      <div class="w-10 h-10 rounded-xl bg-[#0088cc]/10 flex items-center justify-center flex-shrink-0">
        <svg class="w-5 h-5 text-[#0088cc]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d={iconMap[props.icon]} />
        </svg>
      </div>
      <div>
        <p class="font-medium text-primary">{props.title}</p>
        <p class="text-sm text-tertiary">{props.desc}</p>
      </div>
    </div>
  )
}
