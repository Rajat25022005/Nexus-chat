import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useMemo,
} from "react"
import { useAuthStore } from "../stores/authStore"
import { getProfile } from "../api/auth"
import apiClient from "../api/client"
import { useSocket } from "../hooks/useSocket"
import { useGroups } from "../hooks/useGroups"
import { useMessages } from "../hooks/useMessages"
import { usePresence } from "../hooks/usePresence"
import type { Message, Chat, Group, DirectChat } from "../types"

type WorkspaceContextType = {
  groups: Group[]
  directChats: DirectChat[]
  activeGroup: Group | undefined
  activeChat: Chat
  activeGroupId: string
  activeChatId: string
  setActiveGroupId: (id: string) => void
  setActiveChatId: (id: string) => void
  createOrOpenDirectChat: (recipientId: string) => Promise<string | undefined>
  selectDirectChat: (chatId: string) => void
  deleteDirectChat: (chatId: string) => void
  isTyping: boolean
  typingUser: { name: string; isAi: boolean } | null
  onlineUserIds: Set<string>
  isConnected: boolean
  isLoading: boolean
  error: string | null
  streamingMessageId: string | null
  sendMessage: (text: string, triggerAi?: boolean, replyTo?: Message["replyTo"]) => void
  createGroup: (name: string) => Promise<void>
  createChat: (title: string) => Promise<void>
  deleteGroup: (groupId: string) => Promise<void>
  deleteChat: (groupId: string, chatId: string) => Promise<void>
  joinGroup: (code: string) => Promise<void>
  leaveGroup: (groupId: string) => Promise<void>
  removeMember: (groupId: string, email: string) => Promise<void>
  deleteMessage: (messageId: string, type: "everyone" | "me") => void
  editMessage: (messageId: string, content: string) => void
  reactToMessage: (messageId: string, emoji: string) => void
  sendThreadReply: (parentMessageId: string, content: string) => void
  loadThreadMessages: (parentMessageId: string) => Promise<Message[]>
  userEmail: string
  username: string
  profileImage: string | null
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null)

const EMPTY_CHAT: Chat = { id: "", title: "", messages: [] }

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { token, userEmail, username } = useAuthStore()

  const [groups, setGroups] = useState<Group[]>([])
  const [directChats, setDirectChats] = useState<DirectChat[]>([])
  const [activeGroupId, setActiveGroupIdState] = useState<string>(() => localStorage.getItem("nexus_active_group_id") || "")
  const [activeChatId, setActiveChatIdState] = useState<string>(() => localStorage.getItem("nexus_active_chat_id") || "")
  const [isLoading, setIsLoading] = useState(true)
  const [profileImage, setProfileImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const activeGroupIdRef = useRef(activeGroupId)
  const activeChatIdRef = useRef(activeChatId)

  const setActiveGroupId = (id: string) => {
    setActiveGroupIdState(id)
    activeGroupIdRef.current = id
    if (id) {
      localStorage.setItem("nexus_active_group_id", id)
    } else {
      localStorage.removeItem("nexus_active_group_id")
    }
  }

  const setActiveChatId = (id: string) => {
    setActiveChatIdState(id)
    activeChatIdRef.current = id
    if (id) localStorage.setItem("nexus_active_chat_id", id)
  }

  useEffect(() => { activeGroupIdRef.current = activeGroupId }, [activeGroupId])
  useEffect(() => { activeChatIdRef.current = activeChatId }, [activeChatId])

  // Load direct chats from localStorage
  useEffect(() => {
    if (!userEmail) return
    const key = `nexus_direct_chats_${userEmail}`
    const saved = localStorage.getItem(key)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) {
          queueMicrotask(() => {
            setDirectChats(parsed)
          })
        }
      } catch (e) {
        console.error("Failed to load saved direct chats", e)
      }
    }
  }, [userEmail])

  // Save direct chats to localStorage
  useEffect(() => {
    if (userEmail && directChats.length > 0) {
      localStorage.setItem(`nexus_direct_chats_${userEmail}`, JSON.stringify(directChats))
    }
  }, [directChats, userEmail])

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) || groups[0],
    [groups, activeGroupId]
  )

  const activeChat = useMemo(() => {
    const direct = directChats.find((dc) => dc.chat_id === activeChatId)
    if (direct) {
      return {
        id: direct.chat_id,
        title: direct.recipient.display_name || direct.recipient.username || "Direct Message",
        messages: direct.messages || [],
      }
    }
    return activeGroup?.chats.find((c) => c.id === activeChatId) || activeGroup?.chats[0] || EMPTY_CHAT
  }, [activeGroup, activeChatId, directChats])

  const prevTokenRef = useRef(token)

  // Reset state on logout
  useEffect(() => {
    if (prevTokenRef.current && !token) {
      setTimeout(() => {
        setGroups([])
        setDirectChats([])
        setActiveGroupIdState("")
        setActiveChatIdState("")
        setProfileImage(null)
        setError(null)
        setIsLoading(false)
        localStorage.removeItem("nexus_active_group_id")
        localStorage.removeItem("nexus_active_chat_id")
      }, 0)
    }
    prevTokenRef.current = token
  }, [token])

  // Fetch profile image
  useEffect(() => {
    if (!token) return
    getProfile()
      .then((data) => {
        if (data.profile_image) setProfileImage(data.profile_image)
      })
      .catch(console.error)
  }, [token])

  // Fetch groups & synchronize direct chats
  useEffect(() => {
    let isMounted = true
    if (!token) return

    async function fetchGroups() {
      try {
        setIsLoading(true)
        const res = await apiClient.get("/api/groups")
        if (!isMounted) return
        if (res.data.groups && res.data.groups.length > 0) {
          const rawGroups = res.data.groups as Group[]

          // 1. Separate standard workspace groups from direct chat groups
          const regularGroups = rawGroups.filter((g: Group) => g.visibility !== "direct")
          const directGroups = rawGroups.filter((g: Group) => g.visibility === "direct")

          // 2. Set regular workspace groups
          setGroups((prevGroups) => {
            return regularGroups.map((g: Group) => {
              const prevGroup = prevGroups.find((pg) => pg.id === g.id)
              return {
                ...g,
                members: g.members || [],
                chats: g.chats
                  ? g.chats.map((c: Chat) => {
                      const prevChat = prevGroup?.chats.find((pc) => pc.id === c.id)
                      return {
                        ...c,
                        messages: prevChat?.messages || [],
                      }
                    })
                  : [],
              }
            })
          })

          // 3. Extract and merge backend direct chats with local storage state
          if (directGroups.length > 0) {
            setDirectChats((prevDirect) => {
              const merged = [...prevDirect]

              for (const dg of directGroups) {
                const chatId = dg.chats?.[0]?.id
                if (!chatId) continue

                const existingIndex = merged.findIndex((dc) => dc.chat_id === chatId)
                const otherMember = dg.members?.find((m: string) => m !== userEmail) || dg.name || "User"
                const displayName =
                  dg.name && dg.name !== "Direct"
                    ? dg.name
                    : otherMember.includes("@")
                      ? otherMember.split("@")[0]
                      : otherMember

                if (existingIndex >= 0) {
                  const existing = merged[existingIndex]
                  merged[existingIndex] = {
                    ...existing,
                    id: existing.id || dg.id,
                    recipient: {
                      ...existing.recipient,
                      id: existing.recipient.id || dg.owner_id || dg.id,
                      display_name: existing.recipient.display_name || displayName,
                      username:
                        existing.recipient.username ||
                        (otherMember.includes("@") ? otherMember.split("@")[0] : undefined),
                    },
                  }
                } else {
                  merged.push({
                    id: dg.id,
                    chat_id: chatId,
                    recipient: {
                      id: dg.owner_id || dg.id,
                      display_name: displayName,
                      username: otherMember.includes("@") ? otherMember.split("@")[0] : undefined,
                    },
                    created_at: (dg as unknown as { created_at?: string }).created_at || new Date().toISOString(),
                    messages: [],
                  })
                }
              }

              if (userEmail && merged.length > 0) {
                localStorage.setItem(`nexus_direct_chats_${userEmail}`, JSON.stringify(merged))
              }
              return merged
            })
          }

          const savedGroupId = localStorage.getItem("nexus_active_group_id")
          const savedChatId = localStorage.getItem("nexus_active_chat_id")

          // Only default to group chat if no active chat or direct chat is already selected
          if (!activeChatIdRef.current && regularGroups.length > 0) {
            const currentGroup =
              regularGroups.find((g: Group) => g.id === (activeGroupIdRef.current || savedGroupId)) ||
              regularGroups[0]
            if (currentGroup) {
              setActiveGroupId(currentGroup.id)
              const currentChat =
                currentGroup.chats?.find((c: Chat) => c.id === savedChatId) || currentGroup.chats?.[0]
              if (currentChat) {
                setActiveChatId(currentChat.id)
              }
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch groups", err)
        if (isMounted) setError("Failed to load groups. Please refresh the page.")
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    fetchGroups()
    return () => { isMounted = false }
  }, [token, userEmail])

  // Socket connection
  const { isConnected, connectionError } = useSocket(token)
  const combinedError = connectionError || error

  // Online presence tracking across chats
  const { onlineUserIds } = usePresence(activeChatId, isConnected)

  // Group & Direct Chat CRUD
  const {
    createGroup,
    createChat,
    deleteGroup,
    deleteChat,
    joinGroup,
    leaveGroup,
    removeMember,
    createOrOpenDirectChat,
    selectDirectChat,
    deleteDirectChat,
  } = useGroups({
    activeGroupIdRef,
    activeChatIdRef,
    groups,
    setGroups,
    setActiveGroupId,
    setActiveChatId,
    setError,
    userEmail,
    directChats,
    setDirectChats,
  })

  // Messages (socket listeners, history, send/delete/edit)
  const {
    isTyping,
    typingUser,
    streamingMessageId,
    sendMessage,
    deleteMessage,
    editMessage,
    reactToMessage,
    sendThreadReply,
    loadThreadMessages,
  } = useMessages({
    activeGroupId,
    activeChatId,
    activeGroupIdRef,
    activeChatIdRef,
    groups,
    directChats,
    setDirectChats,
    userEmail,
    profileImage,
    isConnected,
    setGroups,
    setError,
  })

  const value = useMemo<WorkspaceContextType>(
    () => ({
      groups,
      directChats,
      activeGroup,
      activeChat,
      activeGroupId,
      activeChatId,
      setActiveGroupId,
      setActiveChatId,
      createOrOpenDirectChat,
      selectDirectChat,
      deleteDirectChat,
      isTyping,
      typingUser,
      onlineUserIds,
      isConnected,
      isLoading,
      error: combinedError,
      streamingMessageId,
      sendMessage,
      createGroup,
      createChat,
      deleteGroup,
      deleteChat,
      joinGroup,
      leaveGroup,
      removeMember,
      deleteMessage,
      editMessage,
      reactToMessage,
      sendThreadReply,
      loadThreadMessages,
      userEmail,
      username,
      profileImage,
    }),
    [
      groups, directChats, activeGroup, activeChat, activeGroupId, activeChatId,
      createOrOpenDirectChat, selectDirectChat, deleteDirectChat,
      isTyping, typingUser, onlineUserIds, isConnected, isLoading, combinedError, streamingMessageId,
      sendMessage, createGroup, createChat, deleteGroup, deleteChat,
      joinGroup, leaveGroup, removeMember, deleteMessage, editMessage,
      reactToMessage, sendThreadReply, loadThreadMessages,
      userEmail, username, profileImage,
    ]
  )

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider")
  return ctx
}
