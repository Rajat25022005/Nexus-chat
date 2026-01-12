export async function fetchMessages(groupId: string, chatId: string) {
  const token = localStorage.getItem("nexus_token")

  const res = await fetch(
    `http://127.0.0.1:8000/api/messages/${groupId}/${chatId}`,
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
