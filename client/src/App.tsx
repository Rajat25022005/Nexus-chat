import { lazy, Suspense, useRef, useEffect, useState, useCallback } from "react"
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom"
import { useAuthStore } from "./stores/authStore"
import { useToast } from "./hooks/useToast"
import { useWorkspace } from "./context/WorkspaceContext"
import { useCommandPaletteStore } from "./stores/commandPaletteStore"
import CommandPalette from "./components/CommandPalette"
import Modal from "./components/Modal"
import NexusToast from "./components/ui/NexusToast"
import type { Toast } from "./components/ui/NexusToast"
import gsap from "gsap"

const Login = lazy(() => import("./pages/Login"))
const Signup = lazy(() => import("./pages/Signup"))
const Chat = lazy(() => import("./pages/Chat"))
const Profile = lazy(() => import("./pages/Profile"))
const Landing = lazy(() => import("./pages/Landing"))
const Onboarding = lazy(() => import("./pages/Onboarding"))
const Settings = lazy(() => import("./pages/Settings"))


function LoadingFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-nexus-bg" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-nexus-primary border-t-transparent" />
        <p className="text-nexus-muted text-sm animate-pulse">Loading...</p>
      </div>
    </div>
  )
}

// Page transition wrapper
function PageTransition({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const location = useLocation()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (prefersReduced) return

    gsap.fromTo(
      el,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.25, ease: "power2.out" }
    )
  }, [location.pathname])

  return <div ref={ref}>{children}</div>
}

export default function App() {
  const navigate = useNavigate()
  const { token, isLoading, logout } = useAuthStore()
  const { toasts, dismissToast } = useToast()
  const {
    groups,
    directChats,
    activeGroupId,
    setActiveGroupId,
    setActiveChatId,
    selectDirectChat,
    createGroup,
    createChat,
    joinGroup,
  } = useWorkspace()

  const { isOpen: isCommandPaletteOpen, close: closeCommandPalette } = useCommandPaletteStore()
  const [paletteModal, setPaletteModal] = useState<"group" | "chat" | "join" | null>(null)
  const [paletteInput, setPaletteInput] = useState("")

  const isAuthenticated = Boolean(!isLoading && token)

  // Global ⌘K / Ctrl+K shortcut active on all pages (/, /chat, /settings, /profile)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        if (isAuthenticated) {
          useCommandPaletteStore.getState().toggle()
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isAuthenticated])

  const handleCommandPaletteSelectGroup = useCallback(
    (groupId: string) => {
      setActiveGroupId(groupId)
      navigate("/chat")
    },
    [setActiveGroupId, navigate]
  )

  const handleCommandPaletteSelectChat = useCallback(
    (chatId: string) => {
      setActiveChatId(chatId)
      navigate("/chat")
    },
    [setActiveChatId, navigate]
  )

  const handleCommandPaletteSelectDirectChat = useCallback(
    (chatId: string) => {
      selectDirectChat(chatId)
      navigate("/chat")
    },
    [selectDirectChat, navigate]
  )

  const handleCommandPaletteNavigate = useCallback(
    (path: string) => {
      navigate(path)
    },
    [navigate]
  )

  const handleCommandPaletteAction = useCallback(
    (action: string) => {
      if (action === "logout") {
        logout()
        navigate("/login")
      } else if (action === "new-chat") {
        navigate("/chat")
        setPaletteModal("chat")
        setPaletteInput("")
      } else if (action === "new-group") {
        navigate("/chat")
        setPaletteModal("group")
        setPaletteInput("")
      } else if (action === "join-group") {
        navigate("/chat")
        setPaletteModal("join")
        setPaletteInput("")
      }
    },
    [logout, navigate]
  )

  const handlePaletteSubmit = useCallback(async () => {
    if (!paletteInput.trim()) return
    try {
      if (paletteModal === "group") {
        await createGroup(paletteInput.trim())
      } else if (paletteModal === "chat") {
        await createChat(paletteInput.trim())
      } else if (paletteModal === "join") {
        await joinGroup(paletteInput.trim())
      }
      navigate("/chat")
    } catch (err) {
      console.error("Failed palette action:", err)
    } finally {
      setPaletteModal(null)
      setPaletteInput("")
    }
  }, [paletteInput, paletteModal, createGroup, createChat, joinGroup, navigate])

  if (isLoading) {
    return <LoadingFallback />
  }

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[9999] focus:px-4 focus:py-2 focus:bg-nexus-primary focus:text-white focus:rounded-xl focus:shadow-xl focus:outline-none focus:ring-2 focus:ring-white"
      >
        Skip to content
      </a>

      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route
            path="/"
            element={
              <PageTransition>
                {isAuthenticated ? <Navigate to="/chat" /> : <Landing />}
              </PageTransition>
            }
          />
          <Route
            path="/login"
            element={
              <PageTransition>
                {isAuthenticated ? <Navigate to="/chat" /> : <Login />}
              </PageTransition>
            }
          />
          <Route
            path="/signup"
            element={
              <PageTransition>
                {isAuthenticated ? <Navigate to="/chat" /> : <Signup />}
              </PageTransition>
            }
          />
          <Route
            path="/onboarding"
            element={
              <PageTransition>
                {isAuthenticated ? <Onboarding /> : <Navigate to="/" />}
              </PageTransition>
            }
          />
          <Route
            path="/chat"
            element={
              <PageTransition>
                {isAuthenticated ? <Chat /> : <Navigate to="/" />}
              </PageTransition>
            }
          />
          <Route
            path="/profile"
            element={
              <PageTransition>
                {isAuthenticated ? <Profile /> : <Navigate to="/" />}
              </PageTransition>
            }
          />
          <Route
            path="/settings"
            element={
              <PageTransition>
                {isAuthenticated ? <Settings /> : <Navigate to="/" />}
              </PageTransition>
            }
          />

          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Suspense>

      {/* Global Command Palette (⌘K) */}
      {isAuthenticated && (
        <>
          <CommandPalette
            isOpen={isCommandPaletteOpen}
            onClose={closeCommandPalette}
            groups={groups}
            directChats={directChats}
            activeGroupId={activeGroupId}
            onSelectGroup={handleCommandPaletteSelectGroup}
            onSelectChat={handleCommandPaletteSelectChat}
            onSelectDirectChat={handleCommandPaletteSelectDirectChat}
            onNavigate={handleCommandPaletteNavigate}
            onAction={handleCommandPaletteAction}
          />

          {/* Creation/Join Modals triggered by Command Palette */}
          <Modal
            isOpen={paletteModal !== null}
            onClose={() => setPaletteModal(null)}
            title={
              paletteModal === "group"
                ? "Create Workspace"
                : paletteModal === "chat"
                ? "New Channel"
                : paletteModal === "join"
                ? "Join Group"
                : ""
            }
          >
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handlePaletteSubmit()
              }}
              className="space-y-4"
            >
              {paletteModal === "join" && (
                <p className="text-xs text-nexus-muted">
                  Enter an invite code (e.g. from workspace settings or another member) to join an existing group.
                </p>
              )}
              <input
                autoFocus
                type="text"
                aria-label={
                  paletteModal === "group"
                    ? "Group Name"
                    : paletteModal === "chat"
                    ? "Chat Title"
                    : "Invite Code"
                }
                className="w-full rounded-xl bg-nexus-bg border border-nexus-border px-4 py-3 text-nexus-text text-sm focus:border-nexus-primary/50 focus:outline-none focus:ring-[3px] focus:ring-nexus-primary/10 transition-all"
                placeholder={
                  paletteModal === "group"
                    ? "Group Name..."
                    : paletteModal === "chat"
                    ? "Chat Title..."
                    : "Invite Code (e.g. NX7K-Q2R9)"
                }
                value={paletteInput}
                onChange={(e) => setPaletteInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    handlePaletteSubmit()
                  }
                }}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPaletteModal(null)}
                  className="px-4 py-2 rounded-xl text-sm text-nexus-muted hover:text-nexus-text hover:bg-nexus-surface transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!paletteInput.trim()}
                  className="px-4 py-2 rounded-xl text-sm font-medium bg-nexus-primary text-white hover:bg-nexus-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {paletteModal === "join" ? "Join" : "Create"}
                </button>
              </div>
            </form>
          </Modal>
        </>
      )}

      {/* Toast container */}
      <div
        role="region"
        aria-label="Notifications"
        className="fixed top-4 right-4 z-[100] flex flex-col gap-2"
      >
        {toasts.map((toast: Toast) => (
          <NexusToast key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </div>
    </>
  )
}
