import { useEffect, useState } from "react"
import { fetchMessages } from "../api/messages"
import { socket } from "../socket"
import axios from "axios"

export type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  sender?: string
}

export type Chat = {
  id: string
  title: string
  messages: Message[]
}

export type Group = {
  id: string
  name: string
  user_id?: string // Owner
  members: string[]
  chats: Chat[]
}

const API_URL = `${import.meta.env.VITE_API_URL || "https://nexus-backend-453285339762.europe-west1.run.app"}/api`

export function useWorkspace() {
  const [groups, setGroups] = useState<Group[]>([])

  const [isAiDisabled, setIsAiDisabled] = useState(false)
  const [activeGroupId, setActiveGroupId] = useState("")
  const [activeChatId, setActiveChatId] = useState("general")
  const [isTyping, setIsTyping] = useState(false)
  const [userEmail, setUserEmail] = useState("")

  const activeGroup = groups.find(g => g.id === activeGroupId) || groups[0]
  const activeChat = activeGroup?.chats.find(c => c.id === activeChatId) || activeGroup?.chats[0]

  useEffect(() => {
    const token = localStorage.getItem("nexus_token")
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        setUserEmail(payload.sub)
      } catch (e) {
        console.error("Failed to decode token", e)
      }
    }
  }, [])

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
          const loadedGroups = res.data.map((g: any) => ({
            ...g,
            chats: g.chats.map((c: any) => ({ ...c, messages: [] }))
          }))
          setGroups(loadedGroups)

          // Set active to first if current is invalid
          if (!loadedGroups.find((g: any) => g.id === activeGroupId)) {
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
  }, []) // Run once on mount

  const [isConnected, setIsConnected] = useState(socket.connected)

  // SOCKET CONNECT + LISTENERS
  // SOCKET CONNECTION (Run Once)
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

    return () => {
      socket.off("connect", onConnect)
      socket.off("disconnect", onDisconnect)
      socket.disconnect()
    }
  }, [])

  // SOCKET LISTENERS (Re-bind when active IDs change to capture correct scope)
  useEffect(() => {
    if (!isConnected) return

    // Socket is already connected via the effect above.

    function onNewMessage(msg: any) {
      // Decode my own email to check if I sent this
      const token = localStorage.getItem("nexus_token")
      let myEmail = ""
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]))
          myEmail = payload.sub
        } catch (e) { console.error(e) }
      }

      console.log("WS: New Message", msg) // Debug log

      // If I sent it, ignore (optimistic update handles it)
      if (msg.role === "user" && msg.sender === myEmail) return

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
                        sender: msg.sender
                      },
                    ],
                  }
                  : chat
              ),
            }
            : group
        )
      )
    }

    function onTyping() {
      setIsTyping(true)
      setTimeout(() => setIsTyping(false), 1500)
    }

    socket.on("new_message", onNewMessage)
    socket.on("typing", onTyping)

    // Re-join room to ensure we are subscribed to the correct channel
    // (Join logic is idempotent-ish, but let's ensure we are in the room)
    socket.emit("join_room", {
      group_id: activeGroupId,
      chat_id: activeChatId,
    })

    return () => {
      socket.off("new_message", onNewMessage)
      socket.off("typing", onTyping)
      socket.emit("leave_room", {
        group_id: activeGroupId,
        chat_id: activeChatId,
      })
    }
  }, [activeGroupId, activeChatId, isConnected])

  // Join Room logic is now integrated into the socket listener effect to ensure sync.

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
                    messages: data.map((m: any) => ({
                      id: crypto.randomUUID(),
                      role: m.role,
                      content: m.content,
                      sender: m.sender
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
  }, [activeGroupId, activeChatId])

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
                      sender: userEmail
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
      disable_ai: isAiDisabled,
    })
  }

  // Handle Join Group Logic
  const joinGroupRefactored = async (groupId: string) => {
    if (!groupId) return;

    const token = localStorage.getItem("nexus_token")
    if (!token) return

    try {
      const res = await axios.post(`${API_URL}/groups/join`, { group_id: groupId }, {
        headers: { Authorization: `Bearer ${token}` }
      })

      // Decode my own email for optimistic update
      let myEmail = ""
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]))
          myEmail = payload.sub
        } catch (e) { console.error(e) }
      }

      // If joined successfully, refresh groups or add it to list
      const newGroup: Group = {
        id: res.data.group_id,
        name: res.data.name,
        members: [myEmail], // Optimistic
        chats: [{ id: "general", title: "General", messages: [] }]
      }

      console.log("Joined group:", newGroup)
      window.location.reload()

    } catch (err) {
      console.error(err)
      alert("Failed to join group. Check ID.")
    }
  }

  // Handle Join Group Event (Backwards compatibility if needed, but we should just use the function)
  useEffect(() => {
    async function handleJoinGroup(e: Event) {
      const groupId = (e as CustomEvent).detail
      joinGroupRefactored(groupId)
    }

    window.addEventListener("join-group", handleJoinGroup)
    return () => window.removeEventListener("join-group", handleJoinGroup)
  }, [])

  const createGroup = async (name: string) => {
    if (!name) return

    const token = localStorage.getItem("nexus_token")
    try {
      const res = await axios.post(`${API_URL}/groups`, { name }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const newGroup = { ...res.data, members: res.data.members || [], chats: res.data.chats.map((c: any) => ({ ...c, messages: [] })) }
      setGroups(prev => [...prev, newGroup])
      setActiveGroupId(newGroup.id)
      if (newGroup.chats.length > 0) setActiveChatId(newGroup.chats[0].id)
    } catch (err) {
      alert("Failed to create group")
    }
  }

  const createChat = async (title: string) => {
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
    } catch (err) {
      alert("Failed to create chat")
    }
  }

  const deleteGroup = async (groupId: string) => {
    const token = localStorage.getItem("nexus_token")
    if (!confirm("Are you sure you want to delete this group? Check that you are the owner.")) return

    try {
      await axios.delete(`${API_URL}/groups/${groupId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      // Update State
      const newGroups = groups.filter(g => g.id !== groupId)
      setGroups(newGroups)
      if (activeGroupId === groupId && newGroups.length > 0) {
        setActiveGroupId(newGroups[0].id)
        setActiveChatId(newGroups[0].chats[0]?.id || "")
      } else if (newGroups.length === 0) {
        setActiveGroupId("")
        setActiveChatId("")
      }

    } catch (err) {
      console.error(err)
      alert("Failed to delete group. Ensure you are the owner and it is not your Personal space.")
    }
  }

  const deleteChat = async (groupId: string, chatId: string) => {
    const token = localStorage.getItem("nexus_token")
    if (!confirm("Delete this chat and all its messages?")) return

    try {
      await axios.delete(`${API_URL}/groups/${groupId}/chats/${chatId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      setGroups(prev => prev.map(g => {
        if (g.id === groupId) {
          const updatedChats = g.chats.filter(c => c.id !== chatId)
          return { ...g, chats: updatedChats }
        }
        return g
      }))

      if (activeChatId === chatId) {
        // Switch to another chat if available
        const group = groups.find(g => g.id === groupId)
        const otherChat = group?.chats.find(c => c.id !== chatId)
        if (otherChat) setActiveChatId(otherChat.id)
        else setActiveChatId("")
      }

    } catch (err) {
      console.error(err)
      alert("Failed to delete chat. Ensure you are the owner.")
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
    createChat,
    deleteGroup,
    deleteChat,
    joinGroup: joinGroupRefactored,
    isAiDisabled,
    setIsAiDisabled,
    userEmail
  }
}
