import apiClient from "./client"

export interface UserSearchResponseItem {
  id: string
  username?: string
  display_name: string
  avatar_url?: string
  email?: string
  email_masked?: string
  phone_number_masked?: string
  phone_masked?: string
  created_at: string
}

export interface UserSearchResponse {
  users: UserSearchResponseItem[]
  total?: number
}

/**
 * Searches users across exact email, verified E.164 phone number, or username prefix.
 * Enforces server query requirements (>= 3 chars).
 */
export async function searchUsers(query: string, limit: number = 10): Promise<UserSearchResponseItem[]> {
  const trimmed = query.trim()
  if (trimmed.length < 3) {
    return []
  }

  const res = await apiClient.get<UserSearchResponse>(
    `/api/v1/users/search?q=${encodeURIComponent(trimmed)}&limit=${limit}`
  )

  return res.data.users || []
}
