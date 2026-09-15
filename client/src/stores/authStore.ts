import { create } from "zustand";
import { authService } from "../services/auth/authService";
import { socket } from "../socket";
import { isTokenExpired, sanitizeToken, purgeSessionTokens } from "../lib/token";

export interface AuthUser {
  email: string;
  username: string;
}

interface AuthState {
  token: string | null;
  userEmail: string;
  username: string;
  isLoading: boolean;
  login: (token: string, email: string, username: string) => void;
  logout: () => void;
  getToken: () => string | null;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: typeof localStorage !== "undefined" ? sanitizeToken(localStorage.getItem("nexus_token")) : null,
  userEmail: "",
  username: "",
  isLoading: true,
  
  login: (token: string, email: string, username: string) => {
    const cleanToken = sanitizeToken(token);
    if (!cleanToken) {
      console.error("Attempted to login with invalid or expired token.");
      return;
    }
    try {
      localStorage.setItem("nexus_token", cleanToken);
    } catch (err) {
      console.error("Failed to store token in localStorage:", err);
    }
    set({ token: cleanToken, userEmail: email, username });
  },
  
  logout: () => {
    purgeSessionTokens();
    // Immediately disconnect background WebSocket to prevent cross-account event leaks
    try {
      socket.disconnect();
    } catch (err) {
      console.error("Failed to disconnect socket on logout:", err);
    }
    set({ token: null, userEmail: "", username: "" });
  },
  
  getToken: () => {
    const current = get().token;
    if (isTokenExpired(current)) {
      get().logout();
      return null;
    }
    return current;
  },
}));

export const initAuth = async () => {
  const rawToken = typeof localStorage !== "undefined" ? localStorage.getItem("nexus_token") : null;
  if (!rawToken || isTokenExpired(rawToken)) {
    useAuthStore.getState().logout();
    useAuthStore.setState({ isLoading: false });
    return;
  }

  const token = sanitizeToken(rawToken);
  if (!token) {
    useAuthStore.getState().logout();
    useAuthStore.setState({ isLoading: false });
    return;
  }

  try {
    const data = await authService.getMe();
    useAuthStore.getState().login(token, data.user.email, data.user.display_name);
  } catch (error) {
    console.error("Failed to authenticate session:", error);
    useAuthStore.getState().logout();
  } finally {
    useAuthStore.setState({ isLoading: false });
  }
};

// Start initialization immediately
initAuth();

// Cross-tab authentication synchronization
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === "nexus_token") {
      if (!e.newValue || isTokenExpired(e.newValue)) {
        useAuthStore.getState().logout();
      } else {
        initAuth();
      }
    }
  });
}

