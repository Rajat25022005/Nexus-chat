import apiClient from "./client"
import type { DirectChatRecipient } from "../types"

export interface CreateDirectChatResponse {
  chat_id: string
  direct_chat_id: string
  recipient: DirectChatRecipient
  created_at: string
  is_new?: boolean
}

/**
 * Initiates or retrieves an existing direct messaging thread with the recipient.
 */
export async function createDirectChat(recipientId: string): Promise<CreateDirectChatResponse> {
  const res = await apiClient.post<CreateDirectChatResponse>("/api/v1/chats/direct", {
    recipient_id: recipientId,
  })
  return res.data
}
