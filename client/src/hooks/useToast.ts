import { create, type StoreApi, type UseBoundStore } from "zustand"
import type { Toast, ToastType } from "../components/ui/NexusToast"

export interface ToastStore {
  toasts: Toast[]
  addToast: (message: string, type?: ToastType) => string
  dismissToast: (id: string) => void
  success: (message: string) => string
  error: (message: string) => string
  info: (message: string) => string
}

export const useToastStore: UseBoundStore<StoreApi<ToastStore>> = create<ToastStore>((set, get) => ({
  toasts: [],
  addToast: (message: string, type: ToastType = "info"): string => {
    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2)
    set((s: ToastStore) => ({ toasts: [...s.toasts, { id, message, type }] }))
    return id
  },
  dismissToast: (id: string): void => set((s: ToastStore) => ({ toasts: s.toasts.filter((t: Toast) => t.id !== id) })),
  success: (msg: string): string => get().addToast(msg, "success"),
  error: (msg: string): string => get().addToast(msg, "error"),
  info: (msg: string): string => get().addToast(msg, "info"),
}))

export function useToast() {
  const toasts = useToastStore((state: ToastStore) => state.toasts)
  const addToast = useToastStore((state: ToastStore) => state.addToast)
  const dismissToast = useToastStore((state: ToastStore) => state.dismissToast)
  const success = useToastStore((state: ToastStore) => state.success)
  const error = useToastStore((state: ToastStore) => state.error)
  const info = useToastStore((state: ToastStore) => state.info)

  return { toasts, addToast, dismissToast, success, error, info }
}
