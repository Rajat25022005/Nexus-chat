import { useState, useEffect } from "react"
import { queryRAG, fetchMessages } from "../api/query"

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
  const [isTyping, setIsTyping] = useState(false)

  const activeGroup =
    groups.find(g => g.id === activeGroupId) ?? groups[0]

  const activeChat =
    activeGroup.chats.find(c => c.id === activeChatId) ??
    activeGroup.chats[0]

  // ✅ NEW: Effect to load messages when switching chats
  useEffect(() => {
    async function loadMessages() {
      // Avoid fetching for non-existent IDs or during initial render if not ready
      if (!activeGroupId || !activeChatId) return

      try {
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
                            id: m.id || crypto.randomUUID(), // Use backend ID if available
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

    const token = localStorage.getItem("nexus_token")
    if (!token) {
      alert("Please login to send messages")
      return
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      status: "sent",
    }

    const aiMessageId = crypto.randomUUID()

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
                        userMessage,
                        {
                          id: aiMessageId,
                          role: "assistant",
                          content: "",
                          status: "sending",
                        },
                      ],
                    }
                  : chat
              ),
            }
          : group
      )
    )

    setIsTyping(true)

    try {
      // Construct history without the 'sending' placeholder
      const rawHistory = activeChat.messages.filter(m => m.status === 'sent')
      
      const history = [
          ...rawHistory.slice(-5),
          userMessage
      ].map(m => ({
          role: m.role,
          content: m.content
      }))

      const result = await queryRAG({
        query: text,
        groupId: activeGroupId,
        chatId: activeChatId,
        history,
      })

      setGroups(prev =>
        prev.map(group =>
          group.id === activeGroupId
            ? {
                ...group,
                chats: group.chats.map(chat =>
                  chat.id === activeChatId
                    ? {
                        ...chat,
                        messages: chat.messages.map(m =>
                          m.id === aiMessageId
                            ? {
                                ...m,
                                content: result.answer,
                                status: "sent",
                              }
                            : m
                        ),
                      }
                    : chat
                ),
              }
            : group
        )
      )
    } catch (error) {
      console.error("RAG Error:", error)
      setGroups(prev =>
        prev.map(group =>
          group.id === activeGroupId
            ? {
                ...group,
                chats: group.chats.map(chat =>
                  chat.id === activeChatId
                    ? {
                        ...chat,
                        messages: chat.messages.map(m =>
                          m.id === aiMessageId
                            ? {
                                ...m,
                                content: "⚠️ Failed to get response",
                                status: "error",
                              }
                            : m
                        ),
                      }
                    : chat
                ),
              }
            : group
        )
      )
    } finally {
      setIsTyping(false)
    }
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
    isTyping,
    sendMessage,
    createGroup,
    createChat,
  }
}