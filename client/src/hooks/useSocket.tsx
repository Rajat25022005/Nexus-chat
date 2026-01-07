import { useEffect, useRef, useState } from "react"
import { io, Socket } from "socket.io-client"
import { useAuth } from "../context/AuthContext"

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000"

export type SocketMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  userId: string
  status: "sent" | "sending" | "error"
  timestamp: string
  sources?: any[]
}

export function useSocket(groupId: string, chatId: string) {
  const { token } = useAuth()
  const socketRef = useRef<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!token || !groupId || !chatId) return

    // Initialize socket connection
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    })

    socketRef.current = socket

    socket.on("connect", () => {
      console.log("✅ Socket connected:", socket.id)
      setIsConnected(true)

      // Join the specific chat room
      socket.emit("join_chat", {
        groupId,
        chatId,
        userId: getUserIdFromToken(token),
        token,
      })
    })

    socket.on("disconnect", () => {
      console.log("❌ Socket disconnected")
      setIsConnected(false)
    })

    socket.on("room_joined", (data) => {
      console.log("🏠 Joined room:", data)
    })

    socket.on("user_joined", (data) => {
      console.log("👤 User joined:", data.userId)
    })

    socket.on("user_left", (data) => {
      console.log("👋 User left:", data.userId)
    })

    socket.on("user_typing", (data) => {
      setTypingUsers(prev => {
        const next = new Set(prev)
        if (data.isTyping) {
          next.add(data.userId)
        } else {
          next.delete(data.userId)
        }
        return next
      })
    })

    socket.on("typing_start", (data) => {
      setTypingUsers(prev => new Set(prev).add(data.userId))
    })

    socket.on("typing_stop", (data) => {
      setTypingUsers(prev => {
        const next = new Set(prev)
        next.delete(data.userId)
        return next
      })
    })

    socket.on("error", (error) => {
      console.error("❌ Socket error:", error)
    })

    // Cleanup
    return () => {
      socket.disconnect()
    }
  }, [token, groupId, chatId])

  const sendMessage = (
    content: string,
    messageId: string,
    history: any[]
  ) => {
    if (!socketRef.current?.connected) {
      console.error("Socket not connected")
      return
    }

    socketRef.current.emit("send_message", {
      groupId,
      chatId,
      content,
      messageId,
      userId: getUserIdFromToken(token!),
      token,
      history,
    })
  }

  const startTyping = () => {
    socketRef.current?.emit("typing_start")
  }

  const stopTyping = () => {
    socketRef.current?.emit("typing_stop")
  }

  const onNewMessage = (callback: (message: SocketMessage) => void) => {
    socketRef.current?.on("new_message", callback)
    return () => {
      socketRef.current?.off("new_message", callback)
    }
  }

  return {
    socket: socketRef.current,
    isConnected,
    typingUsers,
    sendMessage,
    startTyping,
    stopTyping,
    onNewMessage,
  }
}

// Helper to extract user ID from JWT
function getUserIdFromToken(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]))
    return payload.sub || "unknown"
  } catch {
    return "unknown"
  }
}