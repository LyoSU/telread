import { createSignal, Show, createEffect, onCleanup } from 'solid-js'
import { ChevronLeft } from 'lucide-solid'

interface QRCodeLoginProps {
  qrUrl?: string
  onBack: () => void
  isLoading?: boolean
  error?: string
}

/**
 * QR Code login - Telegram native style
 */
export function QRCodeLogin(props: QRCodeLoginProps) {
  const [qrDataUrl, setQrDataUrl] = createSignal<string | null>(null)

  createEffect(() => {
    const url = props.qrUrl
    if (!url) return
    
    let cancelled = false
    
    ;(async () => {
      const QRCode = (await import('qrcode')).default
      if (cancelled) return
      
      const dataUrl = await QRCode.toDataURL(url, {
        width: 200,
        margin: 0,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      })
      
      if (cancelled) return
      setQrDataUrl(dataUrl)
    })()
    
    onCleanup(() => { cancelled = true })
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

      {/* Header */}
      <h1 class="text-[24px] font-semibold text-primary text-center mb-2">
        Log in with QR Code
      </h1>
      <p class="text-[15px] text-secondary text-center mb-6">
        Scan this code with your Telegram app
      </p>

      {/* QR Code */}
      <div class="relative mb-6">
        <div class="w-[232px] h-[232px] p-4 rounded-2xl bg-white flex items-center justify-center shadow-lg">
          <Show
            when={qrDataUrl()}
            fallback={
              <div class="w-[200px] h-[200px] flex items-center justify-center">
                <div class="w-8 h-8 border-2 border-[#0088cc] border-t-transparent rounded-full animate-spin" />
              </div>
            }
          >
            <img
              src={qrDataUrl()!}
              alt="QR Code for Telegram Login"
              class="w-[200px] h-[200px]"
            />
          </Show>
        </div>

        {/* Telegram logo overlay */}
        <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div class="w-12 h-12 rounded-full bg-[#0088cc] flex items-center justify-center shadow-md">
            <svg class="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
            </svg>
          </div>
        </div>
      </div>

      {/* Error */}
      <Show when={props.error}>
        <p class="text-[var(--danger)] text-[13px] text-center mb-4">
          {props.error}
        </p>
      </Show>

      {/* Instructions */}
      <div class="w-full space-y-3">
        <div class="flex items-center gap-3">
          <div class="w-7 h-7 rounded-full bg-[#0088cc]/10 flex items-center justify-center flex-shrink-0">
            <span class="text-[13px] font-semibold text-[#0088cc]">1</span>
          </div>
          <p class="text-[14px] text-secondary">
            Open Telegram on your phone
          </p>
        </div>
        <div class="flex items-center gap-3">
          <div class="w-7 h-7 rounded-full bg-[#0088cc]/10 flex items-center justify-center flex-shrink-0">
            <span class="text-[13px] font-semibold text-[#0088cc]">2</span>
          </div>
          <p class="text-[14px] text-secondary">
            Go to Settings → Devices → Link Desktop Device
          </p>
        </div>
        <div class="flex items-center gap-3">
          <div class="w-7 h-7 rounded-full bg-[#0088cc]/10 flex items-center justify-center flex-shrink-0">
            <span class="text-[13px] font-semibold text-[#0088cc]">3</span>
          </div>
          <p class="text-[14px] text-secondary">
            Point your phone at this screen to confirm
          </p>
        </div>
      </div>
    </div>
  )
}
