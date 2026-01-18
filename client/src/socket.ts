import { io, Socket } from "socket.io-client"
import { API_URL } from "./api/config"

export const socket = io(import.meta.env.VITE_API_URL || "https://nexus-chat-neon-one.vercel.app", {
  autoConnect: false,
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 5,
})

// Update auth token on connection
socket.on("connect", () => {
  const token = localStorage.getItem("nexus_token")
  if (token) {
    socket.auth = { token }
  }
  console.log("Socket connected:", socket.id)
})

socket.on("connect_error", (error: Error) => {
  console.error("Socket connection error:", error)
})

socket.on("disconnect", (reason: string) => {
  console.log("Socket disconnected:", reason)
})

// Helper to update auth token
export function updateSocketAuth(token: string | null) {
  if (token) {
    socket.auth = { token }
    if (!socket.connected) {
      socket.connect()
    }
  } else {
    socket.disconnect()
  }
}
