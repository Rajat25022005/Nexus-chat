import { API_URL } from "./config"

export async function fetchMessages(groupId: string, chatId: string) {
  const token = localStorage.getItem("nexus_token")

  const res = await fetch(
    `${API_URL}/api/messages/${groupId}/${chatId}`,
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
