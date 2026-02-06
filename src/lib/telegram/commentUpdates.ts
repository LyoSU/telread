import { mapMessage } from './messages'
import type { Message as TgMessage } from '@mtcute/web'
import type { Comment } from './comments'

// ============================================================================
// Types
// ============================================================================

export interface CommentSubscription {
  channelId: number
  messageId: number
  discussionChatId: number
  /** ID of the discussion message (thread root) - used to filter comments */
  discussionMessageId?: number
}

export type CommentUpdateCallback = (
  subscription: CommentSubscription,
  update: CommentUpdate
) => void

export type CommentUpdate =
  | { type: 'new'; comment: Comment }
  | { type: 'edit'; comment: Comment }
  | { type: 'delete'; commentIds: number[] }

// ============================================================================
// State
// ============================================================================

/** Map discussionChatId -> CommentSubscription */
const activeSubscriptions = new Map<number, CommentSubscription>()

/** Callbacks to notify when comment updates arrive */
const updateCallbacks = new Set<CommentUpdateCallback>()

// ============================================================================
// Subscription Management
// ============================================================================

/**
 * Subscribe to real-time updates for a comment thread
 * Call this when opening a comment section
 */
export function subscribeToComments(subscription: CommentSubscription): () => void {
  const { discussionChatId } = subscription
  
  if (!discussionChatId) {
    return () => {}
  }
  
  // Store with multiple ID formats for flexible matching
  activeSubscriptions.set(discussionChatId, subscription)
  
  if (import.meta.env.DEV) {
    console.log('[CommentUpdates] Subscribed to discussion chat:', discussionChatId)
  }
  
  // Return unsubscribe function
  return () => {
    activeSubscriptions.delete(discussionChatId)
    
    if (import.meta.env.DEV) {
      console.log('[CommentUpdates] Unsubscribed from discussion chat:', discussionChatId)
    }
  }
}

/**
 * Register a callback to receive comment updates
 */
export function onCommentUpdate(callback: CommentUpdateCallback): () => void {
  updateCallbacks.add(callback)
  return () => {
    updateCallbacks.delete(callback)
  }
}

// ============================================================================
// Message Processing (called from updates.ts)
// ============================================================================

/**
 * Find subscription by chatId, trying multiple ID formats
 * Telegram uses "marked" IDs for channels/supergroups: -100XXXXXXXXXX
 */
function findSubscription(chatId: number): CommentSubscription | undefined {
  // Direct match
  let subscription = activeSubscriptions.get(chatId)
  if (subscription) return subscription
  
  // Try negated
  subscription = activeSubscriptions.get(-chatId)
  if (subscription) return subscription
  
  // Try converting raw to marked format (-100 prefix)
  // Marked ID = -1000000000000 - rawId
  const rawId = Math.abs(chatId)
  const markedId = -1000000000000 - rawId
  subscription = activeSubscriptions.get(markedId)
  if (subscription) return subscription
  
  // Try extracting raw from marked and searching
  if (chatId < -1000000000000) {
    const extractedRaw = Math.abs(chatId) - 1000000000000
    subscription = activeSubscriptions.get(extractedRaw)
    if (subscription) return subscription
    subscription = activeSubscriptions.get(-extractedRaw)
    if (subscription) return subscription
  }
  
  return undefined
}

/**
 * Process a new message from updates.ts
 * Returns true if message was handled as a comment
 */
export function handleCommentMessage(message: TgMessage): boolean {
  const chatId = message.chat?.id
  if (!chatId) return false
  
  const subscription = findSubscription(chatId)
  if (!subscription) return false
  
  // Filter by thread
  const msgAny = message as TgMessage & {
    replyTo?: { replyToTopId?: number; replyToMsgId?: number }
  }
  const threadId = msgAny.replyTo?.replyToTopId
  
  if (subscription.discussionMessageId && threadId && threadId !== subscription.discussionMessageId) {
    return false
  }
  
  const comment = mapMessageToComment(message)
  if (!comment) return false
  
  notifyCallbacks(subscription, { type: 'new', comment })
  
  if (import.meta.env.DEV) {
    console.log('[CommentUpdates] New comment:', chatId, comment.id)
  }
  
  return true
}

/**
 * Process an edited message from updates.ts
 */
export function handleCommentEdit(message: TgMessage): boolean {
  const chatId = message.chat?.id
  if (!chatId) return false
  
  const subscription = findSubscription(chatId)
  if (!subscription) return false
  
  const msgAny = message as TgMessage & {
    replyTo?: { replyToTopId?: number }
  }
  const threadId = msgAny.replyTo?.replyToTopId
  
  if (subscription.discussionMessageId && threadId && threadId !== subscription.discussionMessageId) {
    return false
  }
  
  const comment = mapMessageToComment(message)
  if (!comment) return false
  
  notifyCallbacks(subscription, { type: 'edit', comment })
  
  if (import.meta.env.DEV) {
    console.log('[CommentUpdates] Edited comment:', chatId, comment.id)
  }
  
  return true
}

/**
 * Process deleted messages from updates.ts
 */
export function handleCommentDelete(chatId: number, messageIds: number[]): boolean {
  const subscription = findSubscription(chatId)
  if (!subscription) return false
  
  notifyCallbacks(subscription, { type: 'delete', commentIds: messageIds })
  
  if (import.meta.env.DEV) {
    console.log('[CommentUpdates] Deleted comments:', chatId, messageIds)
  }
  
  return true
}

function notifyCallbacks(subscription: CommentSubscription, update: CommentUpdate): void {
  for (const callback of updateCallbacks) {
    try {
      callback(subscription, update)
    } catch (error) {
      console.error('[CommentUpdates] Callback error:', error)
    }
  }
}

// ============================================================================
// Message to Comment Mapping
// ============================================================================

function mapMessageToComment(message: TgMessage): Comment | null {
  if (!message) return null
  
  const text = message.text ?? ''
  if (!text && !message.media) return null
  
  const chatId = message.chat?.id ?? 0
  const mapped = mapMessage(message, chatId)
  
  const msgAny = message as TgMessage & {
    replyToMessageId?: number
    replyTo?: { replyToMsgId?: number; replyToTopId?: number }
  }
  
  const replyToMsgId = msgAny.replyToMessageId ?? msgAny.replyTo?.replyToMsgId
  const replyToTopId = msgAny.replyTo?.replyToTopId
  
  // Only set replyToId if it's a reply to another comment (not to thread root)
  const replyToId = (replyToMsgId && replyToTopId && replyToMsgId !== replyToTopId) 
    ? replyToMsgId 
    : undefined
  
  const reactions = mapped?.reactions?.map(r => ({
    emoji: r.emoji,
    count: r.count,
  }))
  
  return {
    id: message.id,
    text,
    author: {
      id: message.sender?.id ?? 0,
      name: message.sender?.displayName ?? 'Unknown',
      photo: message.sender?.id ? `user:${message.sender.id}` : undefined,
    },
    date: message.date,
    replyToId,
    reactions,
    entities: mapped?.entities,
    forward: mapped?.forward,
    media: mapped?.media,
  }
}

