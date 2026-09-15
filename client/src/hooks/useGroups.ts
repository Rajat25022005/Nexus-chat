import { useCallback, type MutableRefObject } from "react"
import apiClient from "../api/client"
import { createDirectChat } from "../api/directChats"
import type { Chat, Group, DirectChat } from "../types"

type UseGroupsArgs = {
  activeGroupIdRef: MutableRefObject<string>
  activeChatIdRef: MutableRefObject<string>
  groups: Group[]
  setGroups: React.Dispatch<React.SetStateAction<Group[]>>
  setActiveGroupId: (id: string) => void
  setActiveChatId: (id: string) => void
  setError: (err: string | null) => void
  userEmail?: string
  directChats?: DirectChat[]
  setDirectChats?: React.Dispatch<React.SetStateAction<DirectChat[]>>
}

/**
 * Group & Direct Chat operations: create, delete, join, leave, remove member, direct chats.
 */
export function useGroups({
  activeGroupIdRef,
  activeChatIdRef,
  groups,
  setGroups,
  setActiveGroupId,
  setActiveChatId,
  setError,
  userEmail,
  setDirectChats,
}: UseGroupsArgs) {
  const createGroup = useCallback(async (name: string) => {
    if (!name) return
    try {
      const res = await apiClient.post("/api/groups", { name })
      const newGroup: Group = {
        ...res.data.group,
        members: res.data.group?.members || [],
        chats: (res.data.group?.chats || []).map((c: { id: string; title: string }) => ({
          id: c.id,
          title: c.title,
          messages: [],
        })),
      }
      setGroups((prev) => [...prev, newGroup])
      setActiveGroupId(newGroup.id)
      if (newGroup.chats.length > 0) setActiveChatId(newGroup.chats[0].id)
    } catch (err) {
      console.error("Failed to create group", err)
      setError("Failed to create group")
    }
  }, [setGroups, setActiveGroupId, setActiveChatId, setError])

  const createChat = useCallback(async (title: string) => {
    if (!title) return
    const currentGroupId = activeGroupIdRef.current
    if (!currentGroupId) {
      setError("No active group selected")
      return
    }
    try {
      const res = await apiClient.post("/api/chats", { title, group_id: currentGroupId })
      const newChat: Chat = { ...res.data.chat, messages: [] }
      setGroups((prev) =>
        prev.map((g) =>
          g.id === currentGroupId ? { ...g, chats: [...g.chats, newChat] } : g
        )
      )
      setActiveChatId(newChat.id)
    } catch (err) {
      console.error("Failed to create chat", err)
      setError("Failed to create chat")
    }
  }, [activeGroupIdRef, setGroups, setActiveChatId, setError])

  const deleteGroup = useCallback(
    async (groupId: string) => {
      if (!confirm("Are you sure you want to delete this group?")) return
      try {
        await apiClient.delete(`/api/groups/${groupId}`)
        setGroups((prev) => {
          const newGroups = prev.filter((g) => g.id !== groupId)
          if (activeGroupIdRef.current === groupId && newGroups.length > 0) {
            setActiveGroupId(newGroups[0].id)
            setActiveChatId(newGroups[0].chats[0]?.id || "")
          } else if (newGroups.length === 0) {
            setActiveGroupId("")
            setActiveChatId("")
          }
          return newGroups
        })
      } catch (err) {
        console.error(err)
        setError("Failed to delete group. Ensure you are the owner.")
      }
    },
    [activeGroupIdRef, setGroups, setActiveGroupId, setActiveChatId, setError]
  )

  const deleteChat = useCallback(
    async (groupId: string, chatId: string) => {
      if (!confirm("Delete this chat and all its messages?")) return
      try {
        await apiClient.delete(`/api/groups/${groupId}/chats/${chatId}`)
        setGroups((prev) =>
          prev.map((g) => {
            if (g.id === groupId) {
              const updatedChats = g.chats.filter((c) => c.id !== chatId)
              return { ...g, chats: updatedChats }
            }
            return g
          })
        )
        if (activeChatIdRef.current === chatId) {
          const group = groups.find((g) => g.id === groupId)
          const otherChat = group?.chats.find((c) => c.id !== chatId)
          setActiveChatId(otherChat?.id || "")
        }
      } catch (err) {
        console.error(err)
        setError("Failed to delete chat.")
      }
    },
    [activeChatIdRef, groups, setGroups, setActiveChatId, setError]
  )

  const joinGroup = useCallback(async (code: string) => {
    if (!code) return
    try {
      const res = await apiClient.post("/api/groups/join", { code: code.toUpperCase().trim() })
      const newGroup: Group = {
        ...res.data.group,
        members: res.data.group?.members || [],
        chats: (res.data.group?.chats || []).map((c: { id: string; title: string }) => ({
          id: c.id,
          title: c.title,
          messages: [],
        })),
      }
      setGroups((prev) => {
        if (prev.some((g) => g.id === newGroup.id)) return prev
        return [...prev, newGroup]
      })
      setActiveGroupId(newGroup.id)
      if (newGroup.chats.length > 0) {
        setActiveChatId(newGroup.chats[0].id)
      }
    } catch (err) {
      console.error(err)
      setError("Failed to join group. Check the invite code.")
    }
  }, [setGroups, setActiveGroupId, setActiveChatId, setError])

  const leaveGroup = useCallback(
    async (groupId: string) => {
      if (!confirm("Are you sure you want to leave this group?")) return
      try {
        await apiClient.post(`/api/groups/${groupId}/leave`, {})
        setGroups((prev) => {
          const newGroups = prev.filter((g) => g.id !== groupId)
          if (activeGroupIdRef.current === groupId) {
            if (newGroups.length > 0) {
              setActiveGroupId(newGroups[0].id)
              if (newGroups[0].chats.length > 0) setActiveChatId(newGroups[0].chats[0].id)
            } else {
              setActiveGroupId("")
              setActiveChatId("")
            }
          }
          return newGroups
        })
      } catch (err) {
        console.error(err)
        setError("Failed to leave group.")
      }
    },
    [activeGroupIdRef, setGroups, setActiveGroupId, setActiveChatId, setError]
  )

  const removeMember = useCallback(async (groupId: string, email: string) => {
    if (!confirm(`Remove ${email} from this group?`)) return
    try {
      await apiClient.delete(`/api/groups/${groupId}/members/${email}`)
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId
            ? { ...g, members: g.members.filter((m) => m !== email) }
            : g
        )
      )
    } catch (err) {
      console.error(err)
      setError("Failed to remove member.")
    }
  }, [setGroups, setError])

  // Direct Chats Management
  const createOrOpenDirectChat = useCallback(
    async (recipientId: string) => {
      try {
        const res = await createDirectChat(recipientId)
        const chatId = res.chat_id

        if (setDirectChats) {
          setDirectChats((prev) => {
            const existing = prev.find((dc) => dc.chat_id === chatId)
            if (existing) return prev

            const newChat: DirectChat = {
              id: res.direct_chat_id || res.chat_id,
              chat_id: res.chat_id,
              recipient: {
                id: res.recipient.id,
                display_name: res.recipient.display_name,
                username: res.recipient.username,
                avatar_url: res.recipient.avatar_url,
              },
              created_at: res.created_at || new Date().toISOString(),
              messages: [],
            }
            const updated = [newChat, ...prev]
            if (userEmail) {
              localStorage.setItem(`nexus_direct_chats_${userEmail}`, JSON.stringify(updated))
            }
            return updated
          })
        }

        setActiveChatId(chatId)
        setActiveGroupId("")
        return chatId
      } catch (err) {
        console.error("Failed to create or open direct chat", err)
        setError("Failed to start direct conversation")
      }
    },
    [setActiveChatId, setActiveGroupId, setError, setDirectChats, userEmail]
  )

  const selectDirectChat = useCallback(
    (chatId: string) => {
      setActiveChatId(chatId)
      setActiveGroupId("")
      if (setDirectChats) {
        setDirectChats((prev) =>
          prev.map((dc) => (dc.chat_id === chatId ? { ...dc, unread_count: 0 } : dc))
        )
      }
    },
    [setActiveChatId, setActiveGroupId, setDirectChats]
  )

  const deleteDirectChat = useCallback(
    (chatId: string) => {
      if (setDirectChats) {
        setDirectChats((prev) => {
          const updated = prev.filter((dc) => dc.chat_id !== chatId)
          if (userEmail) {
            localStorage.setItem(`nexus_direct_chats_${userEmail}`, JSON.stringify(updated))
          }
          return updated
        })
      }
      if (activeChatIdRef.current === chatId) {
        setActiveChatId("")
      }
    },
    [activeChatIdRef, setActiveChatId, setDirectChats, userEmail]
  )

  return {
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
  }
}
