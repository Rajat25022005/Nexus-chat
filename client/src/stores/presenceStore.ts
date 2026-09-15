import { create } from "zustand"

export interface PresenceUser {
  uid?: string
  userId?: string
  id?: string
  email?: string
  name?: string
}

interface PresenceState {
  onlineUserIds: Set<string>
  setOnlineUsers: (users: PresenceUser[]) => void
  userJoined: (userId: string, email?: string) => void
  userLeft: (userId: string, email?: string) => void
  isUserOnline: (idOrEmail?: string | null) => boolean
  clearPresence: () => void
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  onlineUserIds: new Set<string>(),

  setOnlineUsers: (users: PresenceUser[]) => {
    const next = new Set(get().onlineUserIds)
    for (const u of users) {
      if (u.uid) next.add(u.uid)
      if (u.userId) next.add(u.userId)
      if (u.id) next.add(u.id)
      if (u.email) next.add(u.email)
    }
    set({ onlineUserIds: next })
  },

  userJoined: (userId: string, email?: string) => {
    if (!userId && !email) return
    const next = new Set(get().onlineUserIds)
    if (userId) next.add(userId)
    if (email) next.add(email)
    set({ onlineUserIds: next })
  },

  userLeft: (userId: string, email?: string) => {
    if (!userId && !email) return
    const next = new Set(get().onlineUserIds)
    if (userId) next.delete(userId)
    if (email) next.delete(email)
    set({ onlineUserIds: next })
  },

  isUserOnline: (idOrEmail?: string | null) => {
    if (!idOrEmail) return false
    return get().onlineUserIds.has(idOrEmail)
  },

  clearPresence: () => {
    set({ onlineUserIds: new Set<string>() })
  },
}))
