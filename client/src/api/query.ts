type ChatMessage = {
  role: "user" | "assistant"
  content: string
}


export function getAuthToken() {
  return localStorage.getItem("nexus_token")
}


export async function queryRAG(params: {
  query: string
  groupId: string
  chatId: string
  history: ChatMessage[]
}) {
  const token = getAuthToken()

  const res = await fetch(`https://nexus-backend-453285339762.europe-west1.run.app/api/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: params.query,
      group_id: params.groupId,
      chat_id: params.chatId,
      history: params.history,
    }),
  })

  if (!res.ok) {
    throw new Error(await res.text())
  }

  return res.json()
}

export async function fetchMessages(groupId: string, chatId: string) {
  const token = getAuthToken()

  const params = new URLSearchParams({
    group_id: groupId,
    chat_id: chatId,
  })

  const res = await fetch(`${import.meta.env.VITE_API_URL}/api/history?${params.toString()}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
  })

  if (!res.ok) {
    throw new Error(await res.text())
  }

  return res.json()
}