import { useEffect, useCallback, useState, useRef, type MutableRefObject } from "react"
import { fetchMessages, fetchThreadMessages } from "../api/query"
import { socket } from "../socket"
import type { Message, Group, DirectChat } from "../types"
import {
  isAuthorizedChat,
  sanitizeSocketString,
  isValidNewMessagePayload,
  isValidMessageDeletedPayload,
  isValidMessageUpdatedPayload,
  isValidTypingPayload,
  isValidAiStreamChunkPayload,
  isValidThreadReplyPayload,
  isValidMessageReactedPayload,
} from "../lib/socketSecurity"

type UseMessagesArgs = {
  activeGroupId: string
  activeChatId: string
  activeGroupIdRef: MutableRefObject<string>
  activeChatIdRef: MutableRefObject<string>
  groups: Group[]
  directChats?: DirectChat[]
  userEmail: string
  profileImage: string | null
  isConnected: boolean
  setGroups: React.Dispatch<React.SetStateAction<Group[]>>
  setDirectChats?: React.Dispatch<React.SetStateAction<DirectChat[]>>
  setError: (err: string | null) => void
}

/**
 * Message operations: load history, send, delete, edit messages.
 * Also manages socket event listeners for real-time message updates across groups and direct chats.
 */
export function useMessages({
  activeGroupId,
  activeChatId,
  activeGroupIdRef,
  activeChatIdRef,
  groups,
  directChats = [],
  userEmail,
  profileImage,
  isConnected,
  setGroups,
  setDirectChats,
  setError,
}: UseMessagesArgs) {
  const [isTyping, setIsTyping] = useState(false)
  const [typingUser, setTypingUser] = useState<{ name: string; isAi: boolean } | null>(null)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)

  // Mutable refs to prevent useEffect teardown storms on incoming messages
  const groupsRef = useRef(groups)
  const directChatsRef = useRef(directChats)
  useEffect(() => { groupsRef.current = groups }, [groups])
  useEffect(() => { directChatsRef.current = directChats }, [directChats])

  // Socket event listeners for messages
  useEffect(() => {
    if (!isConnected) return

    function onNewMessage(rawMsg: unknown) {
      if (!isValidNewMessagePayload(rawMsg)) return
      if (!isAuthorizedChat(rawMsg.chatId, groupsRef.current, directChatsRef.current)) {
        console.warn("[Security Guardrail] Discarded new_message for unjoined room:", rawMsg.chatId)
        return
      }

      const senderEmail = sanitizeSocketString(rawMsg.userEmail || rawMsg.userName || rawMsg.userId || "Unknown", 100)
      const cleanContent = sanitizeSocketString(rawMsg.content, 50000)
      const msg: Message = {
        id: sanitizeSocketString(rawMsg.id, 100),
        role: rawMsg.role === "assistant" ? "assistant" : "user",
        content: cleanContent,
        sender: senderEmail,
        sender_name: rawMsg.userName ? sanitizeSocketString(rawMsg.userName, 100) : undefined,
        sender_image: rawMsg.userAvatar ? sanitizeSocketString(rawMsg.userAvatar, 500) : undefined,
        created_at: rawMsg.createdAt || new Date().toISOString(),
      }
      
      const incomingTempId = rawMsg.tempId ? sanitizeSocketString(rawMsg.tempId, 100) : undefined
      const targetChatId = sanitizeSocketString(rawMsg.chatId, 100)

      // Update direct chats if applicable
      if (setDirectChats) {
        setDirectChats((prev) => {
          const directIndex = prev.findIndex((dc) => dc.chat_id === targetChatId)
          if (directIndex >= 0) {
            return prev.map((dc) => {
              if (dc.chat_id !== targetChatId) return dc
              const isMatch = (m: Message) =>
                m.id === msg.id ||
                (incomingTempId && m.id === incomingTempId) ||
                (m.id.startsWith("temp_") && m.content === msg.content && m.sender === msg.sender)

              const exists = dc.messages.some(isMatch)
              const updatedMessages = exists
                ? dc.messages.map((m) => (isMatch(m) ? { ...msg, id: msg.id } : m))
                : [...dc.messages, msg]

              return {
                ...dc,
                messages: updatedMessages,
                unread_count:
                  targetChatId !== activeChatIdRef.current
                    ? (dc.unread_count || 0) + 1
                    : 0,
              }
            })
          }
          return prev
        })
      }

      // Unified deduplication in groups
      setGroups((prev) =>
        prev.map((group) => ({
          ...group,
          chats: group.chats.map((chat) => {
            if (chat.id !== targetChatId) return chat
            const isMatch = (m: Message) =>
              m.id === msg.id ||
              (incomingTempId && m.id === incomingTempId) ||
              (m.id.startsWith("temp_") && m.content === msg.content && m.sender === msg.sender)

            const exists = chat.messages.some(isMatch)
            return {
              ...chat,
              messages: exists
                ? chat.messages.map((m) => (isMatch(m) ? { ...msg, id: msg.id } : m))
                : [...chat.messages, msg],
            }
          }),
        }))
      )
    }

    function onMessageDeleted(data: unknown) {
      if (!isValidMessageDeletedPayload(data)) return
      const cleanId = sanitizeSocketString(data.id, 100)

      if (setDirectChats) {
        setDirectChats((prev) =>
          prev.map((dc) => ({
            ...dc,
            messages:
              data.type === "everyone"
                ? dc.messages.map((m) =>
                    m.id === cleanId || m.id.endsWith(cleanId)
                      ? { ...m, content: "This message was deleted", is_deleted: true, replyTo: undefined }
                      : m
                  )
                : dc.messages.filter((m) => m.id !== cleanId && !m.id.endsWith(cleanId)),
          }))
        )
      }

      setGroups((prev) =>
        prev.map((group) => ({
          ...group,
          chats: group.chats.map((chat) => ({
            ...chat,
            messages:
              data.type === "everyone"
                ? chat.messages.map((m) =>
                    m.id === cleanId || m.id.endsWith(cleanId)
                      ? { ...m, content: "This message was deleted", is_deleted: true, replyTo: undefined }
                      : m
                  )
                : chat.messages.filter((m) => m.id !== cleanId && !m.id.endsWith(cleanId)),
          })),
        }))
      )
    }

    function onMessageUpdated(data: unknown) {
      if (!isValidMessageUpdatedPayload(data)) return
      if (!isAuthorizedChat(data.chat_id, groupsRef.current, directChatsRef.current)) return

      const cleanId = sanitizeSocketString(data.id, 100)
      const cleanContent = sanitizeSocketString(data.content, 50000)

      if (setDirectChats) {
        setDirectChats((prev) =>
          prev.map((dc) =>
            dc.chat_id === data.chat_id
              ? {
                  ...dc,
                  messages: dc.messages.map((m) =>
                    m.id === cleanId || m.id.endsWith(cleanId)
                      ? { ...m, content: cleanContent, is_edited: true }
                      : m
                  ),
                }
              : dc
          )
        )
      }

      setGroups((prev) =>
        prev.map((group) =>
          !data.group_id || group.id === data.group_id
            ? {
                ...group,
                chats: group.chats.map((chat) =>
                  chat.id === data.chat_id
                    ? {
                        ...chat,
                        messages: chat.messages.map((m) =>
                          m.id === cleanId || m.id.endsWith(cleanId)
                            ? { ...m, content: cleanContent, is_edited: true }
                            : m
                        ),
                      }
                    : chat
                ),
              }
            : group
        )
      )
    }

    function onTyping(data: unknown) {
      if (!isValidTypingPayload(data)) return
      if (data.chatId && !isAuthorizedChat(data.chatId, groupsRef.current, directChatsRef.current)) return
      if (data.chatId && data.chatId !== activeChatIdRef.current) return

      const isAi = data.userId === "ai-assistant" || data.name === "Nexus AI"
      const isSelf = !isAi && (data.name === userEmail || data.userId === userEmail)
      if (isSelf) return

      if (data.isTyping) {
        setIsTyping(true)
        setTypingUser({
          name: isAi ? "Nexus AI" : data.name || "Someone",
          isAi,
        })
      } else {
        setIsTyping(false)
        setTypingUser(null)
      }
    }

    function onAiStreamChunk(data: unknown) {
      if (!isValidAiStreamChunkPayload(data)) return
      if (data.chatId && !isAuthorizedChat(data.chatId, groupsRef.current, directChatsRef.current)) return
      if (data.chatId && data.chatId !== activeChatIdRef.current) return

      const cleanMessageId = sanitizeSocketString(data.messageId, 100)
      const isIncremental = !data.fullContent
      const chunkText = sanitizeSocketString(data.fullContent || data.chunk || data.delta || "", 100000)

      if (data.done || data.isFinal) {
        setStreamingMessageId(null)
        setIsTyping(false)
        setTypingUser(null)
      } else {
        setStreamingMessageId(cleanMessageId)
        setIsTyping(false)
        setTypingUser(null)
      }

      const updateMsgList = (messages: Message[]): Message[] => {
        const exists = messages.some((m) => m.id === cleanMessageId)
        if (exists) {
          return messages.map((m) =>
            m.id === cleanMessageId
              ? {
                  ...m,
                  content: isIncremental ? (m.content || "") + chunkText : chunkText,
                  role: "assistant" as const,
                }
              : m
          )
        } else {
          return [
            ...messages,
            {
              id: cleanMessageId,
              role: "assistant" as const,
              content: chunkText,
              sender: "assistant",
              sender_name: "Nexus AI",
              created_at: new Date().toISOString(),
            },
          ]
        }
      }

      if (setDirectChats) {
        setDirectChats((prev) =>
          prev.map((dc) =>
            dc.chat_id === (data.chatId || activeChatIdRef.current)
              ? { ...dc, messages: updateMsgList(dc.messages) }
              : dc
          )
        )
      }

      setGroups((prev) =>
        prev.map((group) => ({
          ...group,
          chats: group.chats.map((chat) =>
            chat.id === (data.chatId || activeChatIdRef.current)
              ? { ...chat, messages: updateMsgList(chat.messages) }
              : chat
          ),
        }))
      )
    }

    function onMessageReacted(data: unknown) {
      if (!isValidMessageReactedPayload(data)) return
      const p = data
      const msgId = sanitizeSocketString(p.messageId || p.message_id || "", 100)
      const chatId = typeof p.chatId === "string" ? p.chatId : typeof p.chat_id === "string" ? p.chat_id : undefined
      if (chatId && !isAuthorizedChat(chatId, groupsRef.current, directChatsRef.current)) return

      // Backward compatibility: if pre-aggregated reaction object is provided
      if (p.reactions && typeof p.reactions === "object") {
        const rawReactions = p.reactions as Record<string, string[]>
        const updateLegacy = (messages: Message[]) =>
          messages.map((m) => (m.id === msgId ? { ...m, reactions: rawReactions } : m))

        if (setDirectChats) {
          setDirectChats((prev) =>
            prev.map((dc) => (!chatId || dc.chat_id === chatId ? { ...dc, messages: updateLegacy(dc.messages) } : dc))
          )
        }
        setGroups((prev) =>
          prev.map((g) => ({
            ...g,
            chats: g.chats.map((c) => (!chatId || c.id === chatId ? { ...c, messages: updateLegacy(c.messages) } : c)),
          }))
        )
        return
      }

      const emoji = sanitizeSocketString(p.emoji || "", 32)
      const action = p.action === "remove" ? "remove" : "add"
      const reactingUser = sanitizeSocketString(p.userId || p.user_id || "", 100)
      if (!emoji || !reactingUser) return

      const updateIncremental = (messages: Message[]) =>
        messages.map((m) => {
          if (m.id !== msgId) return m
          const reactions = { ...(m.reactions || {}) }
          const users = reactions[emoji] ? [...reactions[emoji]] : []
          const userIdx = users.indexOf(reactingUser)

          if (action === "remove") {
            if (userIdx >= 0) users.splice(userIdx, 1)
            // Also clean up by userEmail if matching
            const emailIdx = users.indexOf(userEmail)
            if (emailIdx >= 0 && reactingUser === userEmail) {
              users.splice(emailIdx, 1)
            }
            if (users.length === 0) {
              delete reactions[emoji]
            } else {
              reactions[emoji] = users
            }
          } else {
            if (userIdx === -1) {
              users.push(reactingUser)
            }
            reactions[emoji] = users
          }
          return { ...m, reactions }
        })

      if (setDirectChats) {
        setDirectChats((prev) =>
          prev.map((dc) => (!chatId || dc.chat_id === chatId ? { ...dc, messages: updateIncremental(dc.messages) } : dc))
        )
      }

      setGroups((prev) =>
        prev.map((group) => ({
          ...group,
          chats: group.chats.map((chat) =>
            !chatId || chat.id === chatId ? { ...chat, messages: updateIncremental(chat.messages) } : chat
          ),
        }))
      )
    }

    function onThreadReply(data: unknown) {
      if (!isValidThreadReplyPayload(data)) return
      if (data.chat_id && !isAuthorizedChat(data.chat_id, groupsRef.current, directChatsRef.current)) return

      const cleanParentId = sanitizeSocketString(data.parentMessageId, 100)
      const incomingReplyId = sanitizeSocketString(data.reply.id, 100)
      const incomingTempId = data.reply.tempId ? sanitizeSocketString(data.reply.tempId, 100) : undefined
      const cleanContent = sanitizeSocketString(data.reply.content, 50000)

      const threadMsg: Message = {
        id: incomingReplyId,
        role: "user",
        content: cleanContent,
        sender: sanitizeSocketString(data.reply.userEmail || data.reply.userName || "Unknown", 100),
        sender_name: data.reply.userName ? sanitizeSocketString(data.reply.userName, 100) : undefined,
        sender_image: data.reply.userAvatar ? sanitizeSocketString(data.reply.userAvatar, 500) : undefined,
        created_at: data.reply.createdAt || new Date().toISOString(),
      }

      const updateThread = (messages: Message[]) =>
        messages.map((m) => {
          if (m.id !== cleanParentId) return m

          const existingReplies = m.thread_messages || []
          const hasMatching = existingReplies.some(
            (r) =>
              r.id === incomingReplyId ||
              (incomingTempId && r.id === incomingTempId) ||
              (r.id.startsWith("thread_temp_") && r.content === threadMsg.content && r.sender === threadMsg.sender)
          )

          const updatedReplies = hasMatching
            ? existingReplies.map((r) =>
                r.id === incomingReplyId ||
                (incomingTempId && r.id === incomingTempId) ||
                (r.id.startsWith("thread_temp_") && r.content === threadMsg.content && r.sender === threadMsg.sender)
                  ? threadMsg
                  : r
              )
            : [...existingReplies, threadMsg]

          return {
            ...m,
            thread_count: hasMatching ? (m.thread_count || updatedReplies.length) : (m.thread_count || 0) + 1,
            thread_last_reply_at: data.reply.createdAt || new Date().toISOString(),
            thread_messages: updatedReplies,
          }
        })

      if (setDirectChats) {
        setDirectChats((prev) =>
          prev.map((dc) =>
            !data.chat_id || dc.chat_id === data.chat_id
              ? { ...dc, messages: updateThread(dc.messages) }
              : dc
          )
        )
      }

      setGroups((prev) =>
        prev.map((group) => ({
          ...group,
          chats: group.chats.map((chat) =>
            !data.chat_id || chat.id === data.chat_id
              ? { ...chat, messages: updateThread(chat.messages) }
              : chat
          ),
        }))
      )
    }

    const onSocketConnect = () => {
      const targetChat = activeChatIdRef.current
      if (targetChat && isAuthorizedChat(targetChat, groupsRef.current, directChatsRef.current)) {
        socket.emit("join_chat", {
          chatId: targetChat,
          groupId: activeGroupIdRef.current || undefined,
        })
      }
    }

    socket.on("connect", onSocketConnect)
    socket.on("new_message", onNewMessage)
    socket.on("message_deleted", onMessageDeleted)
    socket.on("message_updated", onMessageUpdated)
    socket.on("typing", onTyping)
    socket.on("typing_indicator", onTyping)
    socket.on("ai_stream_chunk", onAiStreamChunk)
    socket.on("message_reacted", onMessageReacted)
    socket.on("thread_reply", onThreadReply)

    if (socket.connected && activeChatId && isAuthorizedChat(activeChatId, groupsRef.current, directChatsRef.current)) {
      socket.emit("join_chat", {
        chatId: activeChatId,
        groupId: activeGroupId || undefined,
      })
    }

    return () => {
      socket.off("connect", onSocketConnect)
      socket.off("new_message", onNewMessage)
      socket.off("message_deleted", onMessageDeleted)
      socket.off("message_updated", onMessageUpdated)
      socket.off("typing", onTyping)
      socket.off("typing_indicator", onTyping)
      socket.off("ai_stream_chunk", onAiStreamChunk)
      socket.off("message_reacted", onMessageReacted)
      socket.off("thread_reply", onThreadReply)

      if (socket.connected && activeChatId && isAuthorizedChat(activeChatId, groupsRef.current, directChatsRef.current)) {
        socket.emit("leave_chat", {
          chatId: activeChatId,
          groupId: activeGroupId || undefined,
        })
      }
    }
  }, [isConnected, activeChatId, activeGroupId, userEmail, activeGroupIdRef, activeChatIdRef, setGroups, setDirectChats])


  // Load message history when active chat changes
  const isDirectChat = directChats.some((dc) => dc.chat_id === activeChatId)
  const hasGroup = groups.some((g) => g.id === activeGroupId)

  useEffect(() => {
    if (!activeChatId) return
    if (!isDirectChat && (!activeGroupId || !hasGroup)) return

    let isMounted = true

    async function loadHistory() {
      try {
        const data = await fetchMessages(activeGroupId || "", activeChatId)
        if (!isMounted) return

        if (isDirectChat && setDirectChats) {
          setDirectChats((prev) =>
            prev.map((dc) =>
              dc.chat_id === activeChatId
                ? { ...dc, messages: data, unread_count: 0 }
                : dc
            )
          )
        } else {
          setGroups((prev) =>
            prev.map((group) =>
              group.id === activeGroupId
                ? {
                    ...group,
                    chats: group.chats.map((chat) =>
                      chat.id === activeChatId ? { ...chat, messages: data } : chat
                    ),
                  }
                : group
            )
          )
        }
      } catch (err) {
        console.error("Failed to load history", err)
        if (isMounted) setError("Failed to load message history")
      }
    }

    loadHistory()
    return () => {
      isMounted = false
    }
  }, [activeGroupId, activeChatId, isDirectChat, hasGroup, setGroups, setDirectChats, setError])

  // Actions
  const sendMessage = useCallback(
    (text: string, triggerAi: boolean = false, replyTo?: Message["replyTo"]) => {
      const targetChatId = activeChatIdRef.current
      if (!targetChatId || !isAuthorizedChat(targetChatId, groupsRef.current, directChatsRef.current)) {
        console.warn("[Security Guardrail] Blocked message send to unauthorized or unjoined chat room:", targetChatId)
        return
      }

      const cleanText = sanitizeSocketString(text, 10000)
      if (!cleanText.trim()) return

      const tempId = "temp_" + crypto.randomUUID()
      const optimisticMsg: Message = {
        id: tempId,
        role: "user",
        content: cleanText,
        sender: userEmail,
        sender_image: profileImage || undefined,
        created_at: new Date().toISOString(),
        replyTo,
        status: "sending",
      }

      const isDirect = directChatsRef.current.some((dc) => dc.chat_id === targetChatId)

      if (isDirect && setDirectChats) {
        setDirectChats((prev) =>
          prev.map((dc) =>
            dc.chat_id === targetChatId
              ? { ...dc, messages: [...dc.messages, optimisticMsg] }
              : dc
          )
        )
      } else {
        setGroups((prev) =>
          prev.map((group) =>
            group.id === activeGroupIdRef.current
              ? {
                  ...group,
                  chats: group.chats.map((chat) =>
                    chat.id === targetChatId
                      ? { ...chat, messages: [...chat.messages, optimisticMsg] }
                      : chat
                  ),
                }
              : group
          )
        )
      }

      const activeGroup = groupsRef.current.find((g) => g.id === activeGroupIdRef.current)

      socket.emit(
        "send_message",
        {
          chatId: targetChatId,
          groupId: activeGroupIdRef.current || undefined,
          tenantId: activeGroup?.tenant_id || "",
          workspaceId: activeGroup?.workspace_id || "",
          content: cleanText,
          triggerAI: triggerAi,
          replyTo,
          tempId,
        },
        (ack?: { success?: boolean; messageId?: string; status?: string; error?: string }) => {
          if (ack?.success && ack?.messageId) {
            const serverId = ack.messageId
            const reconcile = (messages: Message[]) =>
              messages.map((m) =>
                m.id === tempId ? { ...m, id: serverId, status: "delivered" as const } : m
              )

            if (setDirectChats) {
              setDirectChats((prev) =>
                prev.map((dc) => (dc.chat_id === targetChatId ? { ...dc, messages: reconcile(dc.messages) } : dc))
              )
            }
            setGroups((prev) =>
              prev.map((g) => ({
                ...g,
                chats: g.chats.map((c) => (c.id === targetChatId ? { ...c, messages: reconcile(c.messages) } : c)),
              }))
            )
          } else if (ack?.error || ack?.success === false) {
            console.error("Message send failed:", ack?.error)
            const markFailed = (messages: Message[]) =>
              messages.map((m) => (m.id === tempId ? { ...m, status: "failed" as const } : m))

            if (setDirectChats) {
              setDirectChats((prev) =>
                prev.map((dc) => (dc.chat_id === targetChatId ? { ...dc, messages: markFailed(dc.messages) } : dc))
              )
            }
            setGroups((prev) =>
              prev.map((g) => ({
                ...g,
                chats: g.chats.map((c) => (c.id === targetChatId ? { ...c, messages: markFailed(c.messages) } : c)),
              }))
            )
            setError(ack?.error || "Failed to deliver message")
          }
        }
      )
    },
    [userEmail, profileImage, activeGroupIdRef, activeChatIdRef, setDirectChats, setGroups, setError]
  )

  const deleteMessage = useCallback(
    (messageId: string, type: "everyone" | "me") => {
      const targetChatId = activeChatIdRef.current
      if (!targetChatId || !isAuthorizedChat(targetChatId, groupsRef.current, directChatsRef.current)) {
        console.warn("[Security Guardrail] Blocked delete action in unauthorized chat room:", targetChatId)
        return
      }
      if (!messageId || typeof messageId !== "string") return
      const cleanMessageId = sanitizeSocketString(messageId, 100)

      socket.emit("delete_message", {
        messageId: cleanMessageId,
        deleteType: type,
        groupId: activeGroupIdRef.current || undefined,
        chatId: targetChatId,
      })

      if (setDirectChats) {
        setDirectChats((prev) =>
          prev.map((dc) =>
            dc.chat_id === targetChatId
              ? {
                  ...dc,
                  messages:
                    type === "everyone"
                      ? dc.messages.map((m) =>
                          m.id === cleanMessageId
                            ? { ...m, content: "This message was deleted", is_deleted: true, replyTo: undefined }
                            : m
                        )
                      : dc.messages.filter((m) => m.id !== cleanMessageId),
                }
              : dc
          )
        )
      }

      setGroups((prev) =>
        prev.map((group) =>
          group.id === activeGroupIdRef.current
            ? {
                ...group,
                chats: group.chats.map((chat) =>
                  chat.id === targetChatId
                    ? {
                        ...chat,
                        messages:
                          type === "everyone"
                            ? chat.messages.map((m) =>
                                m.id === cleanMessageId
                                  ? { ...m, content: "This message was deleted", is_deleted: true, replyTo: undefined }
                                  : m
                              )
                            : chat.messages.filter((m) => m.id !== cleanMessageId),
                      }
                    : chat
                ),
              }
            : group
        )
      )
    },
    [activeGroupIdRef, activeChatIdRef, setDirectChats, setGroups]
  )

  const editMessage = useCallback(
    (messageId: string, content: string) => {
      const targetChatId = activeChatIdRef.current
      if (!targetChatId || !isAuthorizedChat(targetChatId, groupsRef.current, directChatsRef.current)) {
        console.warn("[Security Guardrail] Blocked edit action in unauthorized chat room:", targetChatId)
        return
      }
      if (!messageId || typeof messageId !== "string") return
      const cleanMessageId = sanitizeSocketString(messageId, 100)
      const cleanContent = sanitizeSocketString(content, 10000)
      if (!cleanContent.trim()) return

      socket.emit("edit_message", {
        messageId: cleanMessageId,
        content: cleanContent,
        groupId: activeGroupIdRef.current || undefined,
        chatId: targetChatId,
      })

      if (setDirectChats) {
        setDirectChats((prev) =>
          prev.map((dc) =>
            dc.chat_id === targetChatId
              ? {
                  ...dc,
                  messages: dc.messages.map((m) =>
                    m.id === cleanMessageId ? { ...m, content: cleanContent, is_edited: true } : m
                  ),
                }
              : dc
          )
        )
      }

      setGroups((prev) =>
        prev.map((group) =>
          group.id === activeGroupIdRef.current
            ? {
                ...group,
                chats: group.chats.map((chat) =>
                  chat.id === targetChatId
                    ? {
                        ...chat,
                        messages: chat.messages.map((m) =>
                          m.id === cleanMessageId ? { ...m, content: cleanContent, is_edited: true } : m
                        ),
                      }
                    : chat
                ),
              }
            : group
        )
      )
    },
    [activeGroupIdRef, activeChatIdRef, setDirectChats, setGroups]
  )

  const reactToMessage = useCallback(
    (messageId: string, emoji: string) => {
      const targetChatId = activeChatIdRef.current
      if (!targetChatId || !isAuthorizedChat(targetChatId, groupsRef.current, directChatsRef.current)) {
        console.warn("[Security Guardrail] Blocked reaction in unauthorized chat room:", targetChatId)
        return
      }
      if (!messageId || typeof messageId !== "string" || !emoji || typeof emoji !== "string") return
      const cleanMessageId = sanitizeSocketString(messageId, 100)
      const cleanEmoji = sanitizeSocketString(emoji, 32)
      if (!cleanEmoji.trim()) return

      // Find target message to determine current reaction state
      let targetMsg: Message | undefined
      const targetDirect = directChatsRef.current.find((dc) => dc.chat_id === targetChatId)
      if (targetDirect) {
        targetMsg = targetDirect.messages.find((m) => m.id === cleanMessageId)
      } else {
        for (const g of groupsRef.current) {
          const c = g.chats.find((ch) => ch.id === targetChatId)
          if (c) {
            targetMsg = c.messages.find((m) => m.id === cleanMessageId)
            break
          }
        }
      }

      const existingUsers = targetMsg?.reactions?.[cleanEmoji] || []
      const isAlreadyReacted = existingUsers.includes(userEmail)
      const action: "add" | "remove" = isAlreadyReacted ? "remove" : "add"

      const updateReactionsInList = (messages: Message[]) =>
        messages.map((m) => {
          if (m.id !== cleanMessageId) return m
          const reactions = { ...(m.reactions || {}) }
          const users = reactions[cleanEmoji] ? [...reactions[cleanEmoji]] : []
          const userIdx = users.indexOf(userEmail)
          if (action === "remove") {
            if (userIdx >= 0) users.splice(userIdx, 1)
            if (users.length === 0) delete reactions[cleanEmoji]
            else reactions[cleanEmoji] = users
          } else {
            if (userIdx === -1) users.push(userEmail)
            reactions[cleanEmoji] = users
          }
          return { ...m, reactions }
        })

      if (setDirectChats) {
        setDirectChats((prev) =>
          prev.map((dc) =>
            dc.chat_id === targetChatId
              ? { ...dc, messages: updateReactionsInList(dc.messages) }
              : dc
          )
        )
      }

      setGroups((prev) =>
        prev.map((group) => ({
          ...group,
          chats: group.chats.map((chat) => ({
            ...chat,
            messages: chat.id === targetChatId ? updateReactionsInList(chat.messages) : chat.messages,
          })),
        }))
      )

      socket.emit("react_message", {
        messageId: cleanMessageId,
        emoji: cleanEmoji,
        action,
        groupId: activeGroupIdRef.current || undefined,
        chatId: targetChatId,
      })
    },
    [userEmail, activeGroupIdRef, activeChatIdRef, setDirectChats, setGroups]
  )

  const sendThreadReply = useCallback(
    (parentMessageId: string, content: string) => {
      const targetChatId = activeChatIdRef.current
      if (!targetChatId || !isAuthorizedChat(targetChatId, groupsRef.current, directChatsRef.current)) {
        console.warn("[Security Guardrail] Blocked thread reply in unauthorized chat room:", targetChatId)
        return
      }
      if (!parentMessageId || typeof parentMessageId !== "string") return
      const cleanParentId = sanitizeSocketString(parentMessageId, 100)
      const cleanContent = sanitizeSocketString(content, 10000)
      if (!cleanContent.trim()) return

      const tempId = "thread_temp_" + crypto.randomUUID()
      const threadMsg: Message = {
        id: tempId,
        role: "user",
        content: cleanContent,
        sender: userEmail,
        sender_image: profileImage || undefined,
        created_at: new Date().toISOString(),
      }

      const updateThread = (messages: Message[]) =>
        messages.map((m) => {
          if (m.id !== cleanParentId) return m
          return {
            ...m,
            thread_count: (m.thread_count || 0) + 1,
            thread_last_reply_at: new Date().toISOString(),
            thread_messages: [...(m.thread_messages || []), threadMsg],
          }
        })

      if (setDirectChats) {
        setDirectChats((prev) =>
          prev.map((dc) =>
            dc.chat_id === targetChatId
              ? { ...dc, messages: updateThread(dc.messages) }
              : dc
          )
        )
      }

      setGroups((prev) =>
        prev.map((group) => ({
          ...group,
          chats: group.chats.map((chat) => ({
            ...chat,
            messages: chat.id === targetChatId ? updateThread(chat.messages) : chat.messages,
          })),
        }))
      )

      socket.emit("send_thread_reply", {
        parentMessageId: cleanParentId,
        content: cleanContent,
        groupId: activeGroupIdRef.current || undefined,
        chatId: targetChatId,
        tempId,
      })
    },
    [userEmail, profileImage, activeGroupIdRef, activeChatIdRef, setDirectChats, setGroups]
  )

  const loadThreadMessages = useCallback(
    async (parentMessageId: string) => {
      try {
        const replies = await fetchThreadMessages(parentMessageId)
        const updateReplies = (messages: Message[]) =>
          messages.map((m) => {
            if (m.id !== parentMessageId) return m
            return {
              ...m,
              thread_messages: replies,
              thread_count: replies.length > 0 ? replies.length : m.thread_count,
            }
          })

        if (setDirectChats) {
          setDirectChats((prev) =>
            prev.map((dc) =>
              dc.chat_id === activeChatIdRef.current
                ? { ...dc, messages: updateReplies(dc.messages) }
                : dc
            )
          )
        }

        setGroups((prev) =>
          prev.map((group) => ({
            ...group,
            chats: group.chats.map((chat) => ({
              ...chat,
              messages: chat.id === activeChatIdRef.current ? updateReplies(chat.messages) : chat.messages,
            })),
          }))
        )
        return replies
      } catch (err) {
        console.error("Failed to load thread messages", err)
        return []
      }
    },
    [activeChatIdRef, setDirectChats, setGroups]
  )

  return {
    isTyping,
    typingUser,
    streamingMessageId,
    sendMessage,
    deleteMessage,
    editMessage,
    reactToMessage,
    sendThreadReply,
    loadThreadMessages,
  }
}
