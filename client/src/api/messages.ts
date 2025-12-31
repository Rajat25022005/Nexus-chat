export type Message = {
  role: "user" | "assistant"
  content: string
  created_at: string
}

export async function fetchMessages(
  groupId: string,
  chatId: string,
  token: string
): Promise<Message[]> {
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
