import { useEffect, useState } from "react"
import { fetchMessages } from "../api/messages"
import { socket } from "../socket"
import axios from "axios"
import { API_URL } from "../api/config"

export type Message = {
  id: string
  role: "user" | "assistant"
  content: string
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
      chats: [{ id: "general", title: "General", messages: [] }],
    },
  ])

  const [activeGroupId, setActiveGroupId] = useState("personal")
  const [activeChatId, setActiveChatId] = useState("general")
  const [isTyping, setIsTyping] = useState(false)

  const activeGroup = groups.find(g => g.id === activeGroupId) || groups[0]
  const activeChat = activeGroup?.chats.find(c => c.id === activeChatId) || activeGroup?.chats[0]

  // FETCH GROUPS
  useEffect(() => {
    const token = localStorage.getItem("nexus_token")
    if (!token) return

    async function fetchGroups() {
      try {
        const res = await axios.get(`${API_URL}/groups`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.data.length > 0) {
          // Transform API data to match state shape (add messages array)
          const loadedGroups = res.data.map((g: Group) => ({
            ...g,
            chats: g.chats.map((c: Chat) => ({ ...c, messages: [] }))
          }))
          setGroups(loadedGroups)

          // Set active to first if current is invalid
          if (!loadedGroups.find((g: Group) => g.id === activeGroupId)) {
            setActiveGroupId(loadedGroups[0].id)
            if (loadedGroups[0].chats.length > 0) {
              setActiveChatId(loadedGroups[0].chats[0].id)
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch groups", err)
      }
    }

    fetchGroups()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Run once on mount

  const [isConnected, setIsConnected] = useState(socket.connected)

  // SOCKET CONNECT + LISTENERS
  useEffect(() => {
    const token = localStorage.getItem("nexus_token")
    if (!token) return

    socket.auth = { token }
    socket.connect()

    function onConnect() {
      setIsConnected(true)
      console.log("Socket connected")
    }

    function onDisconnect() {
      setIsConnected(false)
      console.log("Socket disconnected")
    }

    socket.on("connect", onConnect)
    socket.on("disconnect", onDisconnect)

    socket.on("connect_error", (err) => {
      console.error("Socket connection error:", err)
    })

    socket.on("new_message", msg => {
      // If we sent it, we already added it optimistically. 
      // BUT, for AI response, we need to add it.
      // Optimistic update adds it with a temp ID or we can just ignore "user" role if we trust our optimism.
      // The current logic ignores "user" role.
      if (msg.role === "user") return

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
                        id: crypto.randomUUID(),
                        role: msg.role,
                        content: msg.content,
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

    socket.on("typing", () => {
      setIsTyping(true)
      setTimeout(() => setIsTyping(false), 1500)
    })

    return () => {
      socket.off("new_message")
      socket.off("typing")
      socket.off("connect", onConnect)
      socket.off("disconnect", onDisconnect)
      socket.disconnect()
    }
  }, [activeGroupId, activeChatId])

  // JOIN ROOM AFTER CONNECT
  // JOIN ROOM AFTER CONNECT
  useEffect(() => {
    if (!isConnected) return

    socket.emit("join_room", {
      group_id: activeGroupId,
      chat_id: activeChatId,
    })

    return () => {
      if (socket.connected) {
        socket.emit("leave_room", {
          group_id: activeGroupId,
          chat_id: activeChatId,
        })
      }
    }
  }, [activeGroupId, activeChatId, isConnected])

  // LOAD HISTORY
  useEffect(() => {
    if (!activeGroup || !activeChat) return

    async function loadHistory() {
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
                    messages: data.map((m: Message) => ({
                      id: crypto.randomUUID(),
                      role: m.role,
                      content: m.content,
                    })),
                  }
                  : chat
              ),
            }
            : group
        )
      )
    }

    loadHistory()
  }, [activeGroupId, activeChatId, activeGroup, activeChat])

  // SEND MESSAGE (OPTIMISTIC)
  const sendMessage = (text: string) => {
    if (!text.trim()) return

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
                      id: crypto.randomUUID(),
                      role: "user",
                      content: text,
                    },
                  ],
                }
                : chat
            ),
          }
          : group
      )
    )

    socket.emit("send_message", {
      group_id: activeGroupId,
      chat_id: activeChatId,
      content: text,
    })
  }

  const createGroup = async () => {
    const name = prompt("Enter group name:")
    if (!name) return

    const token = localStorage.getItem("nexus_token")
    try {
      const res = await axios.post(`${API_URL}/groups`, { name }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const newGroup = { ...res.data, chats: res.data.chats.map((c: Chat) => ({ ...c, messages: [] })) }
      setGroups(prev => [...prev, newGroup])
      setActiveGroupId(newGroup.id)
      if (newGroup.chats.length > 0) setActiveChatId(newGroup.chats[0].id)
    } catch (err: unknown) {
      console.error("Failed to create group", err)
      alert("Failed to create group")
    }
  }

  const createChat = async () => {
    const title = prompt("Enter chat name:")
    if (!title) return

    const token = localStorage.getItem("nexus_token")
    try {
      const res = await axios.post(`${API_URL}/groups/${activeGroupId}/chats`, { title }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const newChat = { ...res.data, messages: [] }

      setGroups(prev => prev.map(g => {
        if (g.id === activeGroupId) {
          return { ...g, chats: [...g.chats, newChat] }
        }
        return g
      }))
      setActiveChatId(newChat.id)
    } catch (err: unknown) {
      console.error("Failed to create chat", err)
      alert("Failed to create chat")
    }
  }

  return {
    groups,
    activeGroup: activeGroup || groups[0],
    activeChat: activeChat || (activeGroup?.chats[0] ?? { id: "null", title: "", messages: [] }),
    activeGroupId,
    activeChatId,
    setActiveGroupId,
    setActiveChatId,
    isTyping,
    sendMessage,
    createGroup,
    createChat
  }
}
