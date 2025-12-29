type ChatMessage = {
  role: "user" | "assistant"
  content: string
}

type QueryResponse = {
  answer: string
  sources?: {
    id: string
    score: number
    content?: string
  }[]
}

export async function queryRAG(params: {
  query: string
  groupId: string
  chatId: string
  history: ChatMessage[]
}) {
  const res = await fetch("http://localhost:8000/api/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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
