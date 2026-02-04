import { useEffect, useState, useRef } from "react"
import { fetchMessages } from "../api/messages"
import { getProfile } from "../api/auth"
import { socket } from "../socket"
import axios from "axios"


export type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  sender?: string
  sender_name?: string
  sender_image?: string
  replyTo?: {
    id: string
    sender: string
    content: string
  }
  is_deleted?: boolean
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

import { API_URL as BASE_URL } from "../api/config"
const API_URL = `${BASE_URL}/api`


export function useWorkspace() {
  const [groups, setGroups] = useState<Group[]>([])

  const [activeGroupId, setActiveGroupId] = useState("")
  const [activeChatId, setActiveChatId] = useState("general")
  const [isTyping, setIsTyping] = useState(false)
  const [userEmail, setUserEmail] = useState("")
  const [username, setUsername] = useState("")
  const [profileImage, setProfileImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const activeGroupIdRef = useRef(activeGroupId)
  const activeChatIdRef = useRef(activeChatId)

  useEffect(() => {
    activeGroupIdRef.current = activeGroupId
  }, [activeGroupId])

  useEffect(() => {
    activeChatIdRef.current = activeChatId
  }, [activeChatId])

  const activeGroup = groups.find((g) => g.id === activeGroupId) || groups[0]
  const activeChat = activeGroup?.chats.find((c) => c.id === activeChatId) || activeGroup?.chats[0]

  useEffect(() => {
    const token = localStorage.getItem("nexus_token")
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        setUserEmail(payload.sub)
        // Set username if present, otherwise fallback to email prefix or sub
        if (payload.username) {
          setUsername(payload.username)
        } else {
          setUsername(payload.sub.split('@')[0])
        }

        // Fetch full profile to get image
        getProfile(token).then(data => {
          if (data.profile_image) setProfileImage(data.profile_image)
        }).catch(console.error)

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
          const loadedGroups = res.data.map((g: Group) => ({
            ...g,
            chats: g.chats.map((c: Chat) => ({ ...c, messages: [] })),
          }))
          setGroups(loadedGroups)

          // Set active to first if current is invalid
          if (!loadedGroups.find((g: Group) => g.id === activeGroupIdRef.current)) {
            setActiveGroupId(loadedGroups[0].id)
            if (loadedGroups[0].chats.length > 0) {
              setActiveChatId(loadedGroups[0].chats[0].id)
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch groups", err)
        setError("Failed to load groups. Please refresh the page.")
      }
    }

    fetchGroups()
  }, []) // Only run once

  const [isConnected, setIsConnected] = useState(socket.connected)

  // SOCKET CONNECT + LISTENERS
  // SOCKET CONNECTION (Run Once)
  useEffect(() => {
    const token = localStorage.getItem("nexus_token")
    if (!token) return

    // Set auth and connect
    socket.auth = { token }
    socket.connect()

    function onConnect() {
      setIsConnected(true)
      setError(null)
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
      setError("Connection error. Retrying...")
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

      setGroups((prev) =>
        prev.map((group) =>
          group.id === activeGroupIdRef.current
            ? {
              ...group,
              chats: group.chats.map((chat) =>
                chat.id === activeChatIdRef.current
                  ? {
                    ...chat,
                    messages: [
                      ...chat.messages,
                      {
                        id: msg.id || crypto.randomUUID(), // Use backend ID if available
                        role: msg.role,
                        content: msg.content,
                        sender: msg.sender,
                        sender_name: msg.sender_name,
                        sender_image: msg.sender_image,
                        replyTo: msg.replyTo,
                        is_deleted: msg.is_deleted
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

    function onMessageDeleted(data: { id: string, type: "everyone" | "me" }) {
      console.log("WS: Message Deleted", data)
      setGroups(prev => prev.map(group => ({
        ...group,
        chats: group.chats.map(chat => ({
          ...chat,
          messages: data.type === "everyone"
            ? chat.messages.map(m => m.id === data.id || m.id.endsWith(data.id) ? { ...m, content: "This message was deleted", is_deleted: true, replyTo: undefined } : m)
            : chat.messages.filter(m => m.id !== data.id && !m.id.endsWith(data.id)) // For "me", remove it. Note: ID matching might be tricky if using randomUUID locally?
          // Wait, locally generated ID vs DB ID. 
          // The backend uses DB ID. The frontend uses crypto.randomUUID for *optimistic* rendering but replaces it?
          // Actually, the current `onNewMessage` uses crypto.randomUUID for incoming messages too! This is a problem for matching IDs.
          // FIX: We need to use the ID from the backend if available.
          // However, for this task, I will assume the ID passed back corresponds to something we can match. 
          // BUT `fetchMessages` maps DB `_id` to `id`? No, it generates randomUUID too in `loadHistory`.
          // CRITICAL ISSUE: We don't have stable IDs on frontend.
          // I will assume for now that I need to RELOAD the chat to sync or try to fuzzy match? 
          // No, I can't match random UUIDs. 
          // Workaround: Reload chat on delete for now to ensure consistency, OR update `loadHistory` to use real IDs.
          // Let's check `loadHistory` again. It uses `crypto.randomUUID()`.
          // I MUST update `loadHistory` to use the real ID from DB if I want to support deletion.
        }))
      })))

      // Force reload for now to ensure sync until ID refactor
      // Actually, I'll do a quick refactor of loadHistory to use `_id` from DB as `id`.
    }

    function onTyping() {
      setIsTyping(true)
      setTimeout(() => setIsTyping(false), 1500)
    }

    function onMessageUpdated(data: { id: string, content: string, is_edited: boolean, chat_id: string, group_id: string }) {
      setGroups(prev => prev.map(group => group.id === data.group_id ? {
        ...group,
        chats: group.chats.map(chat => chat.id === data.chat_id ? {
          ...chat,
          messages: chat.messages.map(m => m.id === data.id || m.id.endsWith(data.id) ? { ...m, content: data.content } : m)
          // Note: Adding is_edited visual later if needed, user just asked for edit feature.
        } : chat)
      } : group))
    }

    socket.on("new_message", onNewMessage)
    socket.on("message_deleted", onMessageDeleted)
    socket.on("message_updated", onMessageUpdated)
    socket.on("typing", onTyping)

    // Re-join room to ensure we are subscribed to the correct channel
    // (Join logic is idempotent-ish, but let's ensure we are in the room)
    socket.emit("join_room", {
      group_id: activeGroupId,
      chat_id: activeChatId,
    })

    return () => {
      socket.off("new_message", onNewMessage)
      socket.off("message_deleted", onMessageDeleted)
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
    if (!activeGroupId || !activeChatId) return

    async function loadHistory() {
      try {
        const data = await fetchMessages(activeGroupId, activeChatId)

        setGroups((prev) =>
          prev.map((group) =>
            group.id === activeGroupId
              ? {
                ...group,
                chats: group.chats.map((chat) =>
                  chat.id === activeChatId
                    ? {
                      ...chat,
                      messages: data.map((m: any) => ({
                        id: m._id || m.id || crypto.randomUUID(), // Use DB ID if available
                        role: m.role,
                        content: m.content,
                        sender: m.sender || m.user_id,
                        sender_name: m.sender_name,
                        sender_image: m.sender_image,
                        replyTo: m.replyTo,
                        is_deleted: m.is_deleted
                      })),
                    }
                    : chat
                ),
              }
              : group
          )
        )
      } catch (err) {
        console.error("Failed to load history", err)
        setError("Failed to load message history")
      }
    }

    loadHistory()
  }, [activeGroupId, activeChatId])


  // SEND MESSAGE (OPTIMISTIC)
  // SEND MESSAGE (OPTIMISTIC)
  const sendMessage = (text: string, triggerAi: boolean = false, replyTo?: Message['replyTo']) => {
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
                      sender: userEmail,
                      sender_image: profileImage || undefined,
                      replyTo
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
      trigger_ai: triggerAi,
      replyTo
    })
  }

  const deleteMessage = (messageId: string, type: "everyone" | "me") => {
    socket.emit("delete_message", {
      message_id: messageId,
      delete_type: type,
      group_id: activeGroupId,
      chat_id: activeChatId
    })
    // Optimistic update
    setGroups(prev => prev.map(group =>
      group.id === activeGroupId
        ? {
          ...group,
          chats: group.chats.map(chat =>
            chat.id === activeChatId
              ? {
                ...chat,
                messages: type === "everyone"
                  ? chat.messages.map(m => m.id === messageId ? { ...m, content: "This message was deleted", is_deleted: true, replyTo: undefined } : m)
                  : chat.messages.filter(m => m.id !== messageId)
              }
              : chat
          )
        }
        : group
    ))
  }

  const editMessage = (messageId: string, content: string) => {
    socket.emit("edit_message", {
      message_id: messageId,
      content: content,
      group_id: activeGroupId,
      chat_id: activeChatId
    })

    // Optimistic update
    setGroups(prev => prev.map(group =>
      group.id === activeGroupId
        ? {
          ...group,
          chats: group.chats.map(chat =>
            chat.id === activeChatId
              ? {
                ...chat,
                messages: chat.messages.map(m =>
                  m.id === messageId
                    ? { ...m, content: content }
                    : m
                )
              }
              : chat
          )
        }
        : group
    ))
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
    } catch (err: unknown) {
      console.error("Failed to create group", err)
      setError("Failed to create group")
    }
  }

  const createChat = async (title: string) => {
    if (!title) return

    const token = localStorage.getItem("nexus_token")
    const currentGroupId = activeGroupIdRef.current

    try {
      const res = await axios.post(
        `${API_URL}/groups/${currentGroupId}/chats`,
        { title },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      const newChat = { ...res.data, messages: [] }

      setGroups((prev) =>
        prev.map((g) => {
          if (g.id === currentGroupId) {
            return { ...g, chats: [...g.chats, newChat] }
          }
          return g
        })
      )
      setActiveChatId(newChat.id)
    } catch (err: unknown) {
      console.error("Failed to create chat", err)
      setError("Failed to create chat")
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

  const leaveGroup = async (groupId: string) => {
    const token = localStorage.getItem("nexus_token")
    if (!confirm("Are you sure you want to leave this group?")) return

    try {
      await axios.post(`${API_URL}/groups/${groupId}/leave`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      })

      // Update State: Remove group from list
      const newGroups = groups.filter(g => g.id !== groupId)
      setGroups(newGroups)

      // If we were in that group, switch out
      if (activeGroupId === groupId) {
        if (newGroups.length > 0) {
          setActiveGroupId(newGroups[0].id)
          if (newGroups[0].chats.length > 0) setActiveChatId(newGroups[0].chats[0].id)
        } else {
          setActiveGroupId("")
          setActiveChatId("")
        }
      }

    } catch (err) {
      console.error(err)
      alert("Failed to leave group. Owners cannot leave (delete instead).")
    }
  }

  const removeMember = async (groupId: string, email: string) => {
    const token = localStorage.getItem("nexus_token")
    if (!confirm(`Remove ${email} from this group?`)) return

    try {
      await axios.delete(`${API_URL}/groups/${groupId}/members/${email}`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      // Update State: Remove member from group's member list
      setGroups(prev => prev.map(g => {
        if (g.id === groupId) {
          return { ...g, members: g.members.filter(m => m !== email) }
        }
        return g
      }))

    } catch (err) {
      console.error(err)
      alert("Failed to remove member. Ensure you are the owner.")
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
    isConnected,
    error,
    sendMessage,
    createGroup,
    createChat,
    deleteGroup,
    deleteChat,
    joinGroup: joinGroupRefactored,
    leaveGroup,
    removeMember,
    deleteMessage,
    editMessage,
    userEmail,
    username,
    profileImage
  }
}
