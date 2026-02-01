import { getTelegramClient } from './client'
import { TELEGRAM_CONFIG } from '@/config/telegram'
import {
  is2FARequired,
  isInvalidPhoneCode,
  isInvalidPassword,
  isSignUpRequired,
  getErrorMessage,
} from './errors'

export type AuthState =
  | { step: 'idle' }
  | { step: 'phone' }
  | { step: 'code'; phoneCodeHash: string; phone: string }
  | { step: '2fa'; hint?: string }
  | { step: 'qr'; url: string }
  | { step: 'done' }
  | { step: 'error'; message: string }

export interface AuthCallbacks {
  onStateChange: (state: AuthState) => void
}

/**
 * Start phone-based authentication flow
 */
export async function startPhoneAuth(
  phone: string,
  callbacks: AuthCallbacks
): Promise<void> {
  const client = getTelegramClient()

  try {
    const result = await client.sendCode({ phone })

    // In mtcute 0.27+, sendCode can return User (if already logged in) or SentCode
    if ('phoneCodeHash' in result) {
      callbacks.onStateChange({
        step: 'code',
        phoneCodeHash: result.phoneCodeHash,
        phone,
      })
    } else {
      // Already authenticated - this shouldn't happen in normal flow
      callbacks.onStateChange({ step: 'done' })
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to send code'
    callbacks.onStateChange({ step: 'error', message })
  }
}

/**
 * Submit the verification code
 */
export async function submitCode(
  phone: string,
  code: string,
  phoneCodeHash: string,
  callbacks: AuthCallbacks
): Promise<void> {
  const client = getTelegramClient()

  try {
    await client.signIn({
      phone,
      phoneCode: code,
      phoneCodeHash,
    })

    // signIn succeeded - user is authenticated
    callbacks.onStateChange({ step: 'done' })
  } catch (error: unknown) {
    // Check if 2FA is required (typed error check)
    if (is2FARequired(error)) {
      try {
        const passwordInfo = await client.call({ _: 'account.getPassword' })
        callbacks.onStateChange({
          step: '2fa',
          hint: passwordInfo.hint ?? undefined,
        })
        return
      } catch {
        // If we can't get password info, still show 2FA screen
        callbacks.onStateChange({
          step: '2fa',
          hint: undefined,
        })
        return
      }
    }

    // Use typed error checks for better error messages
    if (isInvalidPhoneCode(error)) {
      callbacks.onStateChange({ step: 'error', message: getErrorMessage(error) })
      return
    }

    if (isSignUpRequired(error)) {
      callbacks.onStateChange({
        step: 'error',
        message: 'Account not found. Please use an existing Telegram account.',
      })
      return
    }

    const message = error instanceof Error ? error.message : 'Invalid code'
    callbacks.onStateChange({ step: 'error', message })
  }
}

/**
 * Submit 2FA password
 */
export async function submit2FA(
  password: string,
  callbacks: AuthCallbacks
): Promise<void> {
  const client = getTelegramClient()

  try {
    await client.checkPassword(password)
    callbacks.onStateChange({ step: 'done' })
  } catch (error: unknown) {
    // Use typed error check for better error messages
    if (isInvalidPassword(error)) {
      callbacks.onStateChange({ step: 'error', message: getErrorMessage(error) })
      return
    }
    const message = error instanceof Error ? error.message : 'Invalid password'
    callbacks.onStateChange({ step: 'error', message })
  }
}

// Store for cancelling active QR polling
let cancelQRPolling: (() => void) | null = null

/**
 * Stop any active QR polling
 * Call this when navigating away from QR login screen
 */
export function stopQRAuth(): void {
  if (cancelQRPolling) {
    cancelQRPolling()
    cancelQRPolling = null
  }
}

/**
 * Start QR code authentication
 * Returns cleanup function to stop polling
 */
export async function startQRAuth(callbacks: AuthCallbacks): Promise<void> {
  // Cancel any existing polling first
  stopQRAuth()
  
  const client = getTelegramClient()

  try {
    const result = await client.call({
      _: 'auth.exportLoginToken',
      apiId: TELEGRAM_CONFIG.API_ID,
      apiHash: TELEGRAM_CONFIG.API_HASH,
      exceptIds: [],
    })

    if (result._ === 'auth.loginToken') {
      // Convert token to base64url for QR code
      const tokenBytes = result.token
      const tokenBase64 = btoa(String.fromCharCode(...tokenBytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
      const url = `tg://login?token=${tokenBase64}`

      callbacks.onStateChange({ step: 'qr', url })

      // Poll for login completion
      pollQRLogin(result.expires, callbacks)
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'QR login failed'
    callbacks.onStateChange({ step: 'error', message })
  }
}

function pollQRLogin(
  expires: number,
  callbacks: AuthCallbacks
): void {
  const client = getTelegramClient()
  let cancelled = false
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  // Store cancel function globally
  cancelQRPolling = () => {
    cancelled = true
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  const poll = async () => {
    if (cancelled) return
    
    if (Date.now() / 1000 > expires) {
      // Token expired, get a new one (if not cancelled)
      if (!cancelled) {
        startQRAuth(callbacks)
      }
      return
    }

    try {
      const result = await client.call({
        _: 'auth.exportLoginToken',
        apiId: TELEGRAM_CONFIG.API_ID,
        apiHash: TELEGRAM_CONFIG.API_HASH,
        exceptIds: [],
      })

      if (cancelled) return

      if (result._ === 'auth.loginTokenSuccess') {
        cancelQRPolling = null
        callbacks.onStateChange({ step: 'done' })
        return
      }

      if (!cancelled) {
        timeoutId = setTimeout(poll, 2000)
      }
    } catch (error: unknown) {
      if (cancelled) return
      
      // Use typed error check for 2FA
      if (is2FARequired(error)) {
        cancelQRPolling = null
        try {
          const passwordInfo = await client.call({ _: 'account.getPassword' })
          callbacks.onStateChange({
            step: '2fa',
            hint: passwordInfo.hint ?? undefined,
          })
        } catch {
          callbacks.onStateChange({
            step: '2fa',
            hint: undefined,
          })
        }
        return
      }

      if (!cancelled) {
        timeoutId = setTimeout(poll, 2000)
      }
    }
  }

  poll()
}
