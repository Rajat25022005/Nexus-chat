import { io } from "socket.io-client"
import { SOCKET_URL } from "./api/config"
import { sanitizeToken } from "./lib/token"

export const socket = io(SOCKET_URL, {
  autoConnect: false,
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
  timeout: 10000,
  auth: (cb) => {
    const rawToken = typeof localStorage !== "undefined" ? localStorage.getItem("nexus_token") : null
    const token = sanitizeToken(rawToken)
    cb({ token })
  },
})

socket.on("connect", () => {
  console.log("Socket connected:", socket.id)
})

socket.on("connect_error", (error: Error) => {
  console.error("Socket connection error:", error)
})

socket.on("disconnect", (reason: string) => {
  console.log("Socket disconnected:", reason)
})

// Helper to update auth token securely
export function updateSocketAuth(token: string | null) {
  const safeToken = sanitizeToken(token)
  if (safeToken) {
    socket.auth = { token: safeToken }
    if (!socket.connected) {
      socket.connect()
    }
  } else {
    socket.auth = {}
    socket.disconnect()
  }
}
