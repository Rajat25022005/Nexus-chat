import axios from "axios"
import { API_URL } from "./config"
import { useAuthStore } from "../stores/authStore"
import { sanitizeToken, isTokenExpired } from "../lib/token"

const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
})

// Attach validated auth token to every request automatically
apiClient.interceptors.request.use((config) => {
  const rawToken = typeof localStorage !== "undefined" ? localStorage.getItem("nexus_token") : null

  if (rawToken) {
    // Proactively check if token is expired before sending network request
    if (isTokenExpired(rawToken)) {
      useAuthStore.getState().logout()
      return Promise.reject(new axios.Cancel("Session expired. Please log in again."))
    }

    // Sanitize token to protect against HTTP header injection (CRLF, control characters)
    const safeToken = sanitizeToken(rawToken)
    if (safeToken) {
      config.headers.Authorization = `Bearer ${safeToken}`
    }
  }

  return config
})

// Handle 401 responses globally and enforce clean session termination
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // If request was canceled due to client-side token expiration, redirect to login
    if (axios.isCancel(error)) {
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login"
      }
      return Promise.reject(error)
    }

    const url = error.config?.url || ""
    const isAuthRoute = url.includes("/auth/login") || url.includes("/auth/register")

    if (error.response?.status === 401 && !isAuthRoute) {
      useAuthStore.getState().logout()
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login"
      }
    }
    return Promise.reject(error)
  }
)

export default apiClient

