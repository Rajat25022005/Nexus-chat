type ChatMessage = {
  role: "user" | "assistant"
  content: string
}


export function getAuthToken() {
  return localStorage.getItem("token")
}

export async function queryRAG(params: {
  query: string
  groupId: string
  chatId: string
  history: ChatMessage[]
}) {
  const token = getAuthToken()
  
  const res = await fetch("http://localhost:8000/api/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`, // ✅ Secure Header
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

  const res = await fetch(`http://localhost:8000/api/history?${params.toString()}`, {
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