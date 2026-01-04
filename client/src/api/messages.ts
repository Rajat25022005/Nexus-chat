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
    `https://nexus-backend-453285339762.europe-west1.run.app/api/messages/${groupId}/${chatId}`,
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
