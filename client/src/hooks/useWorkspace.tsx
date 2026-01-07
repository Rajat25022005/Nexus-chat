import { useState, useEffect } from "react"
import { fetchMessages } from "../api/query"
import { useSocket } from "./useSocket"

export type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  status?: "sending" | "sent" | "error"
}

export type Chat = {
  id: string
  title: string
  messages: Message[]
}

export type Group = {
  id: string
  name: string
  chats: Chat[]
}

export function useWorkspace() {
  const [groups, setGroups] = useState<Group[]>([
    {
      id: "personal",
      name: "Personal",
      chats: [
        {
          id: "general",
          title: "General",
          messages: [],
        },
      ],
    },
  ])

  const [activeGroupId, setActiveGroupId] = useState("personal")
  const [activeChatId, setActiveChatId] = useState("general")

  const activeGroup = groups.find(g => g.id === activeGroupId) ?? groups[0]
  const activeChat = activeGroup.chats.find(c => c.id === activeChatId) ?? activeGroup.chats[0]

  // Initialize Socket.IO
  const {
    isConnected,
    typingUsers,
    sendMessage: socketSendMessage,
    startTyping,
    stopTyping,
    onNewMessage,
  } = useSocket(activeGroupId, activeChatId)

  // Listen for incoming messages
  useEffect(() => {
    const cleanup = onNewMessage((socketMessage) => {
      setGroups(prev =>
        prev.map(group =>
          group.id === activeGroupId
            ? {
                ...group,
                chats: group.chats.map(chat =>
                  chat.id === activeChatId
                    ? {
                        ...chat,
                        messages: [
                          ...chat.messages,
                          {
                            id: socketMessage.id,
                            role: socketMessage.role,
                            content: socketMessage.content,
                            status: "sent",
                          },
                        ],
                      }
                    : chat
                ),
              }
            : group
        )
      )
    })

    return cleanup
  }, [activeGroupId, activeChatId, onNewMessage])

  // Load messages when switching chats
  useEffect(() => {
    async function loadMessages() {
      if (!activeGroupId || !activeChatId) return

      try {
        const token = localStorage.getItem("nexus_token")
        if (!token) return

        const data = await fetchMessages(activeGroupId, activeChatId)

        setGroups(prev =>
          prev.map(group =>
            group.id === activeGroupId
              ? {
                  ...group,
                  chats: group.chats.map(chat =>
                    chat.id === activeChatId
                      ? {
                          ...chat,
                          messages: data.map((m: any) => ({
                            id: m.id || crypto.randomUUID(),
                            role: m.role,
                            content: m.content,
                            status: "sent",
                          })),
                        }
                      : chat
                  ),
                }
              : group
          )
        )
      } catch (e) {
        console.error("Failed to load messages", e)
      }
    }

    loadMessages()
  }, [activeGroupId, activeChatId])

  const sendMessage = async (text: string) => {
    if (!text.trim()) return

    const messageId = crypto.randomUUID()

    // Add user message locally (optimistic)
    const userMessage: Message = {
      id: messageId,
      role: "user",
      content: text,
      status: "sent",
    }

    setGroups(prev =>
      prev.map(group =>
        group.id === activeGroupId
          ? {
              ...group,
              chats: group.chats.map(chat =>
                chat.id === activeChatId
                  ? {
                      ...chat,
                      messages: [...chat.messages, userMessage],
                    }
                  : chat
              ),
            }
          : group
      )
    )

    // Send via Socket.IO (will trigger AI response)
    const history = activeChat.messages
      .filter(m => m.status === "sent")
      .slice(-5)
      .map(m => ({
        role: m.role,
        content: m.content,
      }))

    socketSendMessage(text, messageId, history)
  }

  const createGroup = () => {
    const groupId = crypto.randomUUID()
    const chatId = crypto.randomUUID()

    setGroups(prev => [
      {
        id: groupId,
        name: "New Group",
        chats: [
          {
            id: chatId,
            title: "General",
            messages: [],
          },
        ],
      },
      ...prev,
    ])

    setActiveGroupId(groupId)
    setActiveChatId(chatId)
  }

  const createChat = () => {
    const chatId = crypto.randomUUID()

    setGroups(prev =>
      prev.map(group =>
        group.id === activeGroupId
          ? {
              ...group,
              chats: [
                ...group.chats,
                {
                  id: chatId,
                  title: "New Chat",
                  messages: [],
                },
              ],
            }
          : group
      )
    )

    setActiveChatId(chatId)
  }

  return {
    groups,
    activeGroup,
    activeChat,
    activeGroupId,
    activeChatId,
    setActiveGroupId,
    setActiveChatId,
    isTyping: typingUsers.size > 0,
    typingUsers: Array.from(typingUsers),
    isConnected,
    sendMessage,
    startTyping,
    stopTyping,
    createGroup,
    createChat,
  }
}