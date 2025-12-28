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
}): Promise<QueryResponse> {

  const res = await fetch("http://127.0.0.1:8000/rag/query", {
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
    const text = await res.text()
    console.error("RAG backend error:", text)
    throw new Error("RAG request failed")
  }

  return res.json()
}
