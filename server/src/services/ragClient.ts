import axios from "axios"

const RAG_BASE_URL = process.env.RAG_BASE_URL || "http://127.0.0.1:8000"

export async function askRag(
  roomId: string,
  query: string,
  recentMessages: string[]
) {
  const res = await axios.post(`${RAG_BASE_URL}/rag/query`, {
    room_id: roomId,
    query,
    recent_messages: recentMessages
  })

  return res.data
}
