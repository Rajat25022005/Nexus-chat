import { useEffect } from "react"
import { socket } from "../socket"
import { usePresenceStore, type PresenceUser } from "../stores/presenceStore"

export function usePresence(activeChatId?: string, isConnected = false) {
  const setOnlineUsers = usePresenceStore((s) => s.setOnlineUsers)
  const userJoined = usePresenceStore((s) => s.userJoined)
  const userLeft = usePresenceStore((s) => s.userLeft)
  const onlineUserIds = usePresenceStore((s) => s.onlineUserIds)
  const isUserOnline = usePresenceStore((s) => s.isUserOnline)

  useEffect(() => {
    if (!isConnected) return

    function onUserJoined(data: unknown) {
      if (!data || typeof data !== "object") return
      const p = data as { userId?: string; uid?: string; email?: string }
      const id = p.userId || p.uid || ""
      userJoined(id, p.email)
    }

    function onUserLeft(data: unknown) {
      if (!data || typeof data !== "object") return
      const p = data as { userId?: string; uid?: string; email?: string }
      const id = p.userId || p.uid || ""
      userLeft(id, p.email)
    }

    socket.on("user_joined", onUserJoined)
    socket.on("user_left", onUserLeft)

    // Query online users for the current room or globally
    const payload = activeChatId ? { chatId: activeChatId } : {}
    socket.emit("get_online_users", payload, (response: unknown) => {
      if (Array.isArray(response)) {
        setOnlineUsers(response as PresenceUser[])
      }
    })

    return () => {
      socket.off("user_joined", onUserJoined)
      socket.off("user_left", onUserLeft)
    }
  }, [isConnected, activeChatId, userJoined, userLeft, setOnlineUsers])

  return { onlineUserIds, isUserOnline }
}
