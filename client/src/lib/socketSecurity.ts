import type { Group, DirectChat } from "../types"

/**
 * Validates whether a target chat ID belongs to an authorized group or direct chat
 * that the current client has explicitly joined.
 */
export function isAuthorizedChat(
  chatId: string | undefined | null,
  groups: Group[],
  directChats: DirectChat[] = []
): boolean {
  if (!chatId || typeof chatId !== "string" || !chatId.trim()) return false
  const cleanChatId = chatId.trim()

  const inGroups = groups.some((g) => g.chats && g.chats.some((c) => c.id === cleanChatId))
  if (inGroups) return true

  const inDirect = directChats.some((dc) => dc.chat_id === cleanChatId)
  if (inDirect) return true

  return false
}

/**
 * Sanitizes a string received over WebSockets:
 * - Truncates to maxLen to avoid memory exhaustion / DOM freeze
 * - Strips ASCII null bytes and non-printable control characters
 */
export function sanitizeSocketString(val: unknown, maxLen = 10000): string {
  if (typeof val !== "string") return ""
  let clean = ""
  for (let i = 0; i < val.length; i++) {
    const c = val.charCodeAt(i)
    // Keep tab (9), newline (10), carriage return (13), and printable characters (>= 32 and != 127)
    if ((c >= 32 && c !== 127) || c === 9 || c === 10 || c === 13) {
      clean += val[i]
    }
  }
  return clean.slice(0, maxLen)
}


/**
 * Validates the structure and types of an incoming new_message packet.
 */
export function isValidNewMessagePayload(data: unknown): data is {
  id: string
  role?: "user" | "assistant"
  content: string
  userId?: string
  userEmail?: string
  userName?: string
  userAvatar?: string
  createdAt?: string
  tempId?: string
  chatId: string
} {
  if (!data || typeof data !== "object") return false
  const p = data as Record<string, unknown>
  if (typeof p.id !== "string" || !p.id.trim()) return false
  if (typeof p.chatId !== "string" || !p.chatId.trim()) return false
  if (typeof p.content !== "string") return false
  return true
}

/**
 * Validates the structure of an incoming message_deleted packet.
 */
export function isValidMessageDeletedPayload(data: unknown): data is {
  id: string
  type: "everyone" | "me"
} {
  if (!data || typeof data !== "object") return false
  const p = data as Record<string, unknown>
  if (typeof p.id !== "string" || !p.id.trim()) return false
  if (p.type !== "everyone" && p.type !== "me") return false
  return true
}

/**
 * Validates the structure of an incoming message_updated packet.
 */
export function isValidMessageUpdatedPayload(data: unknown): data is {
  id: string
  content: string
  chat_id: string
  group_id?: string
} {
  if (!data || typeof data !== "object") return false
  const p = data as Record<string, unknown>
  if (typeof p.id !== "string" || !p.id.trim()) return false
  if (typeof p.content !== "string") return false
  if (typeof p.chat_id !== "string" || !p.chat_id.trim()) return false
  return true
}

/**
 * Validates the structure of an incoming typing indicator packet.
 */
export function isValidTypingPayload(data: unknown): data is {
  userId: string
  isTyping: boolean
  chatId?: string
  name?: string
} {
  if (!data || typeof data !== "object") return false
  const p = data as Record<string, unknown>
  if (typeof p.userId !== "string") return false
  if (typeof p.isTyping !== "boolean") return false
  return true
}

/**
 * Validates the structure of an incoming ai_stream_chunk packet.
 */
export function isValidAiStreamChunkPayload(data: unknown): data is {
  messageId: string
  chunk?: string
  fullContent?: string
  delta?: string
  done?: boolean
  isFinal?: boolean
  chatId?: string
} {
  if (!data || typeof data !== "object") return false
  const p = data as Record<string, unknown>
  if (typeof p.messageId !== "string" || !p.messageId.trim()) return false
  return true
}

/**
 * Validates the structure of an incoming thread_reply packet.
 */
export function isValidThreadReplyPayload(data: unknown): data is {
  parentMessageId: string
  reply: {
    id: string
    tempId?: string
    content: string
    userEmail?: string
    userName?: string
    userAvatar?: string
    createdAt?: string
  }
  chat_id?: string
} {
  if (!data || typeof data !== "object") return false
  const p = data as Record<string, unknown>
  if (typeof p.parentMessageId !== "string" || !p.parentMessageId.trim()) return false
  if (!p.reply || typeof p.reply !== "object") return false
  const r = p.reply as Record<string, unknown>
  if (typeof r.id !== "string" || !r.id.trim()) return false
  if (typeof r.content !== "string") return false
  return true
}

/**
 * Validates the structure of an incoming message_reacted packet.
 */
export function isValidMessageReactedPayload(data: unknown): data is {
  messageId?: string
  message_id?: string
  emoji?: string
  userId?: string
  user_id?: string
  action?: "add" | "remove"
  chatId?: string
  chat_id?: string
  reactions?: Record<string, string[]>
} {
  if (!data || typeof data !== "object") return false
  const p = data as Record<string, unknown>
  const msgId = p.message_id || p.messageId
  if (typeof msgId !== "string" || !msgId.trim()) return false
  return true
}
