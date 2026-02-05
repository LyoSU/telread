import { getTelegramClient, getClientVersion, onClientReset } from './client'
import { mapMessage, type MessageReaction, type Message } from './messages'
import { mapChatToChannel } from './channels'
import { clearFoldersCache } from './folders'
import { queryClient, queryKeys } from '@/lib/query'
import {
  handleCommentMessage,
  handleCommentEdit,
  handleCommentDelete,
} from './commentUpdates'
import {
  upsertPost,
  removePosts,
  updatePostViews,
  updatePostReactions,
  isStoreReady,
  getPost,
  getChannel,
  upsertChannel,
  addArchivedChannelId,
  removeArchivedChannelId,
} from '@/lib/store'
import type { Message as TgMessage, RawUpdateInfo, Chat, tl } from '@mtcute/web'



export type UpdatesCleanup = () => void

let isListenerActive = false
let activeCleanup: UpdatesCleanup | null = null
let listenerClientVersion = 0
let isPaused = false

// Queue for messages that arrive before store is ready
const pendingMessages: TgMessage[] = []

// ============================================================================
// Batched Updates Processing
// ============================================================================

// Balance between responsiveness and battery usage
// 100ms = ~10 batches/sec max during heavy updates, idle when no updates
const BATCH_INTERVAL_MS = 100

interface UpdateBatch {
  messages: TgMessage[]
}

const pendingBatch: UpdateBatch = {
  messages: [],
}

let batchTimer: ReturnType<typeof setTimeout> | null = null

function scheduleBatchProcessing(): void {
  if (batchTimer || isPaused) return

  batchTimer = setTimeout(() => {
    batchTimer = null
    processBatch()
  }, BATCH_INTERVAL_MS)
}

function processBatch(): void {
  const { messages } = pendingBatch
  pendingBatch.messages = []

  if (messages.length === 0) {
    // Even if batch is empty, try to process any pending messages
    // that were queued before store was ready
    if (isStoreReady() && pendingMessages.length > 0) {
      processPendingMessages()
    }
    return
  }

  // Check if store is ready - if not, move messages to pending queue
  if (!isStoreReady()) {
    if (import.meta.env.DEV) {
      console.log(`[Updates] Store not ready, queueing ${messages.length} messages`)
    }
    pendingMessages.push(...messages)
    return
  }

  // Deduplicate - keep latest version of each message
  const uniqueByKey = new Map<string, TgMessage>()
  for (const msg of messages) {
    const key = `${msg.chat?.id}:${msg.id}`
    uniqueByKey.set(key, msg)
  }

  // Filter to broadcast channel messages and map
  // Note: supergroups are handled separately via handleCommentMessage
  const mapped: Message[] = []
  let skippedNonChannel = 0
  let skippedNoContent = 0

  for (const msg of uniqueByKey.values()) {
    const peer = msg.chat
    if (!peer || peer.type !== 'chat') {
      skippedNonChannel++
      continue
    }
    const chat = peer as Chat

    // Only process broadcast channels (chatType === 'channel')
    // Supergroups/gigagroups are discussion groups, handled via comment handlers
    if (chat.chatType !== 'channel') {
      skippedNonChannel++
      continue
    }

    // Check if channel exists in store
    const existingChannel = getChannel(peer.id)

    if (!existingChannel) {
      // Channel not in store - add it via dynamic discovery
      // This could be a new subscription, so we should process it
      const channel = mapChatToChannel(chat)
      upsertChannel(channel)
      if (import.meta.env.DEV) {
        console.log(`[Updates] Discovered channel via update: ${peer.id} "${chat.title}"`)
      }
    }

    const post = mapMessage(msg, peer.id)
    if (post) {
      mapped.push(post)
    } else {
      skippedNoContent++
      if (import.meta.env.DEV) {
        // Log why message was skipped (service message, etc.)
        console.log(`[Updates] Skipped message ${msg.id} in ${peer.id}: no text/media (service message?)`)
      }
    }
  }

  if (import.meta.env.DEV) {
    const total = uniqueByKey.size
    if (skippedNonChannel > 0 || skippedNoContent > 0) {
      console.log(`[Updates] Batch: ${total} unique, ${mapped.length} mapped, ${skippedNonChannel} non-channel, ${skippedNoContent} no content`)
    } else if (mapped.length > 0) {
      console.log(`[Updates] Processed ${mapped.length} messages`)
    }
  }

  if (mapped.length === 0) return

  // Add posts to pending (Twitter-style) - batched for efficiency
  for (const post of mapped) {
    upsertPost(post) // Individual call for pendingKeys behavior
  }

  // Also process any pending messages that were queued before store was ready
  if (pendingMessages.length > 0) {
    processPendingMessages()
  }
}

function queueMessage(message: TgMessage): void {
  pendingBatch.messages.push(message)
  scheduleBatchProcessing()
}

// ============================================================================
// Visibility Change Handler
// ============================================================================

let visibilityCleanup: (() => void) | null = null

function handleVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    // Pause processing when tab is hidden
    isPaused = true

    // Process any pending batch immediately before pausing
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
      processBatch()
    }

    if (import.meta.env.DEV) {
      console.log('[Updates] Paused (tab hidden)')
    }
  } else {
    // Resume when tab is visible
    isPaused = false

    // Process any messages that arrived while paused
    if (pendingBatch.messages.length > 0) {
      scheduleBatchProcessing()
    }

    if (import.meta.env.DEV) {
      console.log('[Updates] Resumed (tab visible)')
    }
  }
}

function startVisibilityListener(): () => void {
  if (typeof document === 'undefined') return () => { }

  document.addEventListener('visibilitychange', handleVisibilityChange)
  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }
}

function stopVisibilityListener(): void {
  if (visibilityCleanup) {
    visibilityCleanup()
    visibilityCleanup = null
  }
}

/**
 * Process pending messages that were queued before store was ready
 */
function processPendingMessages(): void {
  if (pendingMessages.length === 0) return

  const messages = [...pendingMessages]
  pendingMessages.length = 0 // Clear queue

  // Filter to channel messages and map
  const mapped: Message[] = []
  for (const message of messages) {
    const peer = message.chat
    const chatId = peer?.id
    if (!chatId) continue

    // Only process channel messages
    if (peer.type !== 'chat') continue
    const chat = peer as Chat
    if (chat.chatType !== 'channel') continue

    const post = mapMessage(message, chatId)
    if (post) mapped.push(post)
  }

  if (mapped.length === 0) return

  // Add to pending (these are real-time updates that arrived before store was ready)
  for (const post of mapped) {
    upsertPost(post) // Individual call for pendingKeys behavior
  }
}

/**
 * Start listening for real-time Telegram updates
 *
 * Updates are applied to the centralized posts store.
 * Both timeline and channel views read from this store.
 */
export function startUpdatesListener(): UpdatesCleanup {
  // Clean up any existing listener first
  if (activeCleanup) {
    activeCleanup()
    activeCleanup = null
  }

  // Clear any pending batch from previous session
  if (batchTimer) {
    clearTimeout(batchTimer)
    batchTimer = null
  }
  pendingBatch.messages = []
  isPaused = false

  // Start visibility listener for pause/resume on tab switch
  visibilityCleanup = startVisibilityListener()

  const client = getTelegramClient()
  const clientVersion = getClientVersion()
  listenerClientVersion = clientVersion

  const handleNewMessage = (message: TgMessage) => {
    if (getClientVersion() !== listenerClientVersion) return

    try {
      const chatId = message.chat?.id
      if (!chatId) {
        if (import.meta.env.DEV) {
          console.log('[Updates] Skipped message without chatId:', message.id)
        }
        return
      }

      const peer = message.chat
      if (!peer || peer.type !== 'chat') {
        if (import.meta.env.DEV) {
          console.log('[Updates] Skipped non-chat message:', chatId, message.id, peer?.type)
        }
        return
      }

      const chat = peer as Chat

      // Handle channel posts - always queue, processBatch will check store readiness
      if (chat.chatType === 'channel') {
        queueMessage(message)
        return
      }

      // Handle discussion group messages (comments)
      if (chat.chatType === 'supergroup') {
        handleCommentMessage(message)
        return
      }

      if (import.meta.env.DEV) {
        console.log('[Updates] Skipped message from:', chat.chatType, chatId)
      }
    } catch (error) {
      console.error('[Updates] Error handling new message:', error)
    }
  }

  const handleEditMessage = (message: TgMessage) => {
    if (getClientVersion() !== listenerClientVersion) return

    try {
      const chatId = message.chat?.id
      if (!chatId) return

      const peer = message.chat
      if (!peer || peer.type !== 'chat') return
      const chat = peer as Chat

      // Handle channel posts
      if (chat.chatType === 'channel') {
        // Queue channel messages - processBatch handles store readiness
        queueMessage(message)
        return
      }

      // Handle discussion group messages (comments)
      // Comments don't need store to be ready - they have separate state
      if (chat.chatType === 'supergroup') {
        handleCommentEdit(message)
        return
      }
    } catch (error) {
      console.error('[Updates] Error handling edit message:', error)
    }
  }

  const handleDeleteMessage = (update: { messageIds: number[]; channelId: number | null }) => {
    if (getClientVersion() !== listenerClientVersion) return

    try {
      const channelId = update.channelId
      if (channelId === null) return

      // Try to handle as channel post deletion
      removePosts(channelId, update.messageIds)

      // Also try to handle as comment deletion (if subscribed)
      handleCommentDelete(channelId, update.messageIds)
    } catch (error) {
      console.error('[Updates] Error handling delete message:', error)
    }
  }

  /** Telegram channel ID offset for "marked" IDs */
  const CHANNEL_ID_OFFSET = -1000000000000
  
  /**
   * Convert raw Telegram channel ID to marked format (-100 prefix)
   */
  const toMarkedChannelId = (rawId: number): number => CHANNEL_ID_OFFSET - rawId

  /**
   * Handle raw updates for views, reactions, etc.
   */
  const handleRawUpdate = (info: RawUpdateInfo) => {
    if (getClientVersion() !== listenerClientVersion) return

    try {
      const update = info.update as tl.TypeUpdate

      // Handle folder updates (created, deleted, reordered)
      if (
        update._ === 'updateDialogFilter' ||
        update._ === 'updateDialogFilters' ||
        update._ === 'updateDialogFilterOrder' ||
        update._ === 'updatePinnedDialogs'
      ) {
        if (import.meta.env.DEV) {
          console.log(`[Updates] Folders changed (${update._}), invalidating caches`)
        }

        // Clear internal memory cache and invalidate queries
        clearFoldersCache()
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.folders.all }),
          queryClient.invalidateQueries({ queryKey: queryKeys.timeline.all }),
        ]).catch((error) => {
          console.error('[Updates] Failed to invalidate queries:', error)
        })
        return
      }

      // Handle archive/unarchive changes (folder_id 0 = main, 1 = archive)
      // This is the key update for instant archive status sync
      if (update._ === 'updateFolderPeers') {
        // Access folderPeers from the raw update
        const rawUpdate = update as tl.RawUpdateFolderPeers
        const folderPeers = rawUpdate.folderPeers

        if (Array.isArray(folderPeers)) {
          for (const fp of folderPeers) {
            // Validate folder peer structure
            if (!fp?.peer || typeof fp.folderId !== 'number') continue
            
            // Only care about channels (not users or groups)
            if (fp.peer._ === 'peerChannel') {
              const rawId = Number(fp.peer.channelId)
              
              // Skip if NaN or invalid
              if (!Number.isFinite(rawId)) continue
              
              const channelId = toMarkedChannelId(rawId)
              
              if (fp.folderId === 1) {
                // Moved to archive
                addArchivedChannelId(channelId)
                if (import.meta.env.DEV) {
                  console.log(`[Updates] Channel ${channelId} archived`)
                }
              } else if (fp.folderId === 0) {
                // Moved to main folder
                removeArchivedChannelId(channelId)
                if (import.meta.env.DEV) {
                  console.log(`[Updates] Channel ${channelId} unarchived`)
                }
              }
            }
          }
        }

        // Also invalidate folder caches
        clearFoldersCache()
        void queryClient.invalidateQueries({ queryKey: queryKeys.folders.all }).catch((error) => {
          console.error('[Updates] Failed to invalidate folders:', error)
        })
        return
      }

      // Handle view count updates
      if (update._ === 'updateChannelMessageViews') {
        const channelId = update.channelId ? toMarkedChannelId(update.channelId) : 0
        if (channelId) {
          updatePostViews(channelId, update.id, update.views)
        }
        return
      }

      // Handle reaction updates
      if (update._ === 'updateMessageReactions') {
        const peer = update.peer
        if (peer?._ === 'peerChannel' && update.reactions?.results) {
          const channelId = toMarkedChannelId(peer.channelId)

          // Get existing post to preserve chosen state
          // Raw updates don't include whether current user chose the reaction
          const existingPost = getPost(channelId, update.msgId)
          const existingReactions = existingPost?.reactions ?? []
          const chosenMap = new Map(
            existingReactions.filter((r) => r.chosen).map((r) => [r.emoji, true])
          )

          const reactions: MessageReaction[] = []
          for (const r of update.reactions.results) {
            if (r.count <= 0) continue
            // Skip paid reactions (stars)
            if (r.reaction?._ === 'reactionPaid') continue
            // Skip custom emojis - only support standard emoji
            if (r.reaction?._ !== 'reactionEmoji') continue

            const emoji = r.reaction.emoticon ?? '👍'
            reactions.push({
              emoji,
              count: r.count ?? 0,
              // Preserve chosen state from existing reactions
              chosen: chosenMap.get(emoji) ?? false,
            })
          }

          updatePostReactions(channelId, update.msgId, reactions)
        }
        return
      }
    } catch {
      // Silently ignore raw update errors
    }
  }

  // Register handlers
  try {
    client.onNewMessage?.add(handleNewMessage)
    client.onEditMessage?.add(handleEditMessage)
    client.onDeleteMessage?.add(handleDeleteMessage)
    client.onRawUpdate?.add(handleRawUpdate)
    isListenerActive = true
  } catch (error) {
    console.error('[Updates] Error registering handlers:', error)
    isListenerActive = false
  }

  const cleanup: UpdatesCleanup = () => {
    try {
      // Stop visibility listener
      stopVisibilityListener()

      // Clear batch timer and process remaining messages
      if (batchTimer) {
        clearTimeout(batchTimer)
        batchTimer = null
      }
      if (pendingBatch.messages.length > 0) {
        processBatch()
      }

      // Clear pending messages queue (messages that arrived before store was ready)
      pendingMessages.length = 0

      // Reset pause state
      isPaused = false

      // Remove Telegram event handlers
      client.onNewMessage?.remove(handleNewMessage)
      client.onEditMessage?.remove(handleEditMessage)
      client.onDeleteMessage?.remove(handleDeleteMessage)
      client.onRawUpdate?.remove(handleRawUpdate)
    } catch (error) {
      console.error('[Updates] Error removing handlers:', error)
    } finally {
      isListenerActive = false
      if (activeCleanup === cleanup) {
        activeCleanup = null
      }
    }
  }

  activeCleanup = cleanup
  return cleanup
}

export function stopUpdatesListener(): void {
  if (activeCleanup) {
    activeCleanup()
    activeCleanup = null
  }
}

/**
 * Clean up batch timer and queues — prevents stale timer firing after logout
 */
function cleanupBatchState(): void {
  if (batchTimer) {
    clearTimeout(batchTimer)
    batchTimer = null
  }
  pendingBatch.messages = []
  pendingMessages.length = 0
  isPaused = false
}

// Register cleanup with client so it runs on logout/reset (avoids circular import)
onClientReset(cleanupBatchState)

export function isUpdatesListenerActive(): boolean {
  return isListenerActive
}

/**
 * Call this when initial data is loaded to process queued messages
 */
export function onTimelineLoaded(): void {
  processPendingMessages()
}
