import { useNavigate } from '@solidjs/router'
import { AuthFlow } from '@/components/auth'
import { authStore } from '@/lib/store/auth'
import { getTelegramClient, setClientReady } from '@/lib/telegram/client'
import { startUpdatesListener } from '@/lib/telegram/updates'

/**
 * Login page wrapper
 */
function Login() {
  const navigate = useNavigate()

  const handleSuccess = async () => {
    const client = getTelegramClient()

    // Get user and set auth
    const user = await client.getMe()
    authStore.setUser(user)

    // Mark client as ready for API calls
    setClientReady(true)

    // IMPORTANT: Register handlers BEFORE starting updates loop
    // This ensures we don't miss any updates that arrive immediately
    startUpdatesListener()

    // Start updates loop (non-blocking)
    client.startUpdatesLoop().catch(console.error)

    // Navigate to home
    navigate('/', { replace: true })
  }

  return <AuthFlow onSuccess={handleSuccess} />
}

export default Login
