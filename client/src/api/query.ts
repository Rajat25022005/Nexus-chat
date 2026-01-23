


export function getAuthToken() {
  return localStorage.getItem("nexus_token")
}


import { API_URL } from "./config"

export async function queryAI({
  query,
  group_id,
  chat_id,
}: {
  query: string
  group_id: string
  chat_id: string
}) {
  const token = getAuthToken()

  const res = await fetch(`${API_URL}/api/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      query,
      group_id,
      chat_id,
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

  const res = await fetch(`${API_URL}/api/history?${params.toString()}`, {
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
