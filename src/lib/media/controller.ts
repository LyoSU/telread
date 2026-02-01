/**
 * Global Media Controller
 * 
 * Best practices for media in feeds (Twitter/Instagram/TikTok style):
 * - Only ONE media plays at a time
 * - Videos: muted autoplay when visible, tap to unmute
 * - Audio/Voice: no autoplay, only on tap
 * - Auto-pause when scrolled out of view
 * - Smooth transitions between media
 * - Media Session API for lock screen controls (mobile)
 */

type MediaType = 'video' | 'audio' | 'voice' | 'video_note'

interface MediaInfo {
  title?: string
  artist?: string
  artwork?: string
}

interface MediaInstance {
  id: string
  type: MediaType
  element: HTMLMediaElement
  metadata?: MediaInfo
  pause: () => void
  cleanupTimeUpdate?: () => void
}

class MediaController {
  private current: MediaInstance | null = null
  private instances = new Map<string, MediaInstance>()
  
  constructor() {
    this.setupMediaSession()
  }
  
  /**
   * Setup Media Session API for lock screen controls
   */
  private setupMediaSession(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    
    navigator.mediaSession.setActionHandler('play', () => {
      if (this.current) {
        this.current.element.play().catch(() => {})
      }
    })
    
    navigator.mediaSession.setActionHandler('pause', () => {
      if (this.current) {
        this.current.pause()
      }
    })
    
    navigator.mediaSession.setActionHandler('stop', () => {
      this.pauseAll()
    })
    
    // Seek handlers for audio/voice
    navigator.mediaSession.setActionHandler('seekbackward', () => {
      if (this.current) {
        this.current.element.currentTime = Math.max(0, this.current.element.currentTime - 10)
      }
    })
    
    navigator.mediaSession.setActionHandler('seekforward', () => {
      if (this.current) {
        this.current.element.currentTime = Math.min(
          this.current.element.duration || 0,
          this.current.element.currentTime + 10
        )
      }
    })
  }
  
  /**
   * Update Media Session metadata
   */
  private updateMediaSession(instance: MediaInstance): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    
    const { metadata, type } = instance
    
    // Set metadata
    navigator.mediaSession.metadata = new MediaMetadata({
      title: metadata?.title || (type === 'video' || type === 'video_note' ? 'Video' : 'Audio'),
      artist: metadata?.artist || 'Telread',
      artwork: metadata?.artwork ? [{ src: metadata.artwork, sizes: '512x512' }] : [],
    })
    
    // Update playback state
    navigator.mediaSession.playbackState = 'playing'
    
    // Cleanup previous timeupdate listener if exists
    instance.cleanupTimeUpdate?.()
    
    // Update position state
    const updatePosition = () => {
      if (!this.current || this.current.id !== instance.id) return
      
      const { element } = instance
      if (element.duration && !isNaN(element.duration)) {
        navigator.mediaSession.setPositionState({
          duration: element.duration,
          playbackRate: element.playbackRate,
          position: element.currentTime,
        })
      }
    }
    
    instance.element.addEventListener('timeupdate', updatePosition)
    instance.cleanupTimeUpdate = () => {
      instance.element.removeEventListener('timeupdate', updatePosition)
    }
    updatePosition()
  }
  
  /**
   * Register a media element with the controller
   */
  register(
    id: string,
    type: MediaType,
    element: HTMLMediaElement,
    callbacks?: { onPause?: () => void },
    metadata?: MediaInfo
  ): () => void {
    const instance: MediaInstance = {
      id,
      type,
      element,
      metadata,
      pause: () => {
        element.pause()
        callbacks?.onPause?.()
        if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'paused'
        }
      },
    }
    
    this.instances.set(id, instance)
    
    // Return unregister function
    return () => {
      const inst = this.instances.get(id)
      inst?.cleanupTimeUpdate?.()
      this.instances.delete(id)
      if (this.current?.id === id) {
        this.current = null
        if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'none'
        }
      }
    }
  }
  
  /**
   * Request to play media - pauses any currently playing media
   */
  play(id: string): boolean {
    const instance = this.instances.get(id)
    if (!instance) return false
    
    // Pause current if different
    if (this.current && this.current.id !== id) {
      this.current.pause()
    }
    
    this.current = instance
    
    // Update Media Session (for lock screen controls)
    this.updateMediaSession(instance)
    
    // Play with proper handling
    const playPromise = instance.element.play()
    if (playPromise) {
      playPromise.catch(() => {
        // Autoplay blocked - this is fine, user will tap to play
      })
    }
    
    return true
  }
  
  /**
   * Pause specific media
   */
  pause(id: string): void {
    const instance = this.instances.get(id)
    if (instance) {
      instance.pause()
      if (this.current?.id === id) {
        this.current = null
      }
    }
  }
  
  /**
   * Pause all media (e.g., when navigating away)
   */
  pauseAll(): void {
    if (this.current) {
      this.current.pause()
      this.current = null
    }
  }
  
  /**
   * Toggle mute for current media
   */
  toggleMute(id: string): boolean {
    const instance = this.instances.get(id)
    if (!instance) return false
    
    instance.element.muted = !instance.element.muted
    return !instance.element.muted
  }
  
  /**
   * Check if specific media is currently playing
   */
  isPlaying(id: string): boolean {
    return this.current?.id === id && !this.current.element.paused
  }
  
  /**
   * Check if specific media is muted
   */
  isMuted(id: string): boolean {
    const instance = this.instances.get(id)
    return instance?.element.muted ?? true
  }
  
  /**
   * Get current playing media id
   */
  getCurrentId(): string | null {
    return this.current?.id ?? null
  }
}

// Singleton instance
export const mediaController = new MediaController()

// Pause all media when navigating (SPA navigation)
if (typeof window !== 'undefined') {
  // Pause on visibility change (tab switch)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      mediaController.pauseAll()
    }
  })
}
