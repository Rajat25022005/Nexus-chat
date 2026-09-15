export type ReplyTo = {
  id: string
  sender: string
  content: string
}

export type FileAttachment = {
  id?: string
  name: string
  url: string
  download_url?: string
  contentType?: string
  size?: number
}

export type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  sender?: string
  sender_name?: string
  sender_image?: string
  replyTo?: ReplyTo
  is_deleted?: boolean
  is_edited?: boolean
  created_at?: string
  reactions?: Record<string, string[]>
  thread_count?: number
  thread_last_reply_at?: string
  thread_messages?: Message[]
  attachments?: FileAttachment[]
  status?: "sending" | "delivered" | "failed"
}

export type Chat = {
  id: string
  title: string
  messages: Message[]
}

export type DirectChatRecipient = {
  id: string
  display_name: string
  username?: string
  avatar_url?: string
}

export type DirectChat = {
  id: string
  chat_id: string
  recipient: DirectChatRecipient
  created_at: string
  messages: Message[]
  unread_count?: number
}

export type Group = {
  id: string
  name: string
  owner_id?: string
  user_id?: string
  invite_code?: string
  visibility?: string
  join_policy?: string
  members: string[]
  chats: Chat[]
  tenant_id?: string
  workspace_id?: string
}

export type User = {
  email: string
  username: string
  profileImage: string | null
  fullName?: string
  bio?: string
  isPrivate?: boolean
}
