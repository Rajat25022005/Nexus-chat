import { API_URL } from "./config"

export async function fetchMessages(groupId: string, chatId: string) {
  const token = localStorage.getItem("nexus_token")

  const res = await fetch(
    `${import.meta.env.VITE_API_URL || "https://nexus-chat-neon-one.vercel.app"}/api/messages/${groupId}/${chatId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  )

  if (!res.ok) {
    throw new Error("Failed to fetch messages")
  }

  return res.json()
}
