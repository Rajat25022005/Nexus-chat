import { useState, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { Search, X, MessageSquare, Mail, Phone, Loader2 } from "lucide-react"
import { searchUsers, type UserSearchResponseItem } from "../api/discovery"
import { getImageUrl } from "../api/config"

type Props = {
  isOpen: boolean
  onClose: () => void
  onSelectUser: (user: UserSearchResponseItem) => void
}

export default function UserSearchModal({ isOpen, onClose, onSelectUser }: Props) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<UserSearchResponseItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const handleClose = useCallback(() => {
    setQuery("")
    setResults([])
    setError(null)
    setHasSearched(false)
    onClose()
  }, [onClose])

  // WCAG Compliance: Focus trapping, scroll locking, Escape key listener, and focus restoration
  useEffect(() => {
    if (!isOpen) return

    previousFocusRef.current = document.activeElement as HTMLElement | null

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const timer = setTimeout(() => inputRef.current?.focus(), 50)

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        handleClose()
        return
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (focusableElements.length === 0) return
        const first = focusableElements[0]
        const last = focusableElements[focusableElements.length - 1]

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => {
      clearTimeout(timer)
      window.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = originalOverflow
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === "function") {
        previousFocusRef.current.focus()
      }
    }
  }, [isOpen, handleClose])

  // Debounced search (300ms)
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 3) {
      return
    }

    const timer = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const users = await searchUsers(trimmed)
        setResults(users)
        setHasSearched(true)
      } catch (err: unknown) {
        console.error("Search failed", err)
        setError("Failed to search users. Please try again.")
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query])

  const handleQueryChange = (val: string) => {
    setQuery(val)
    if (val.trim().length < 3) {
      setResults([])
      setLoading(false)
      setError(null)
      setHasSearched(false)
    }
  }

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) handleClose()
    },
    [handleClose]
  )

  if (!isOpen) return null

  return createPortal(
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-[fadeIn_0.2s_ease-out]"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Find Users"
        className="w-full max-w-md rounded-2xl border border-nexus-border/50 bg-nexus-card/95 backdrop-blur-xl shadow-2xl relative overflow-hidden flex flex-col max-h-[85vh] animate-[scaleIn_0.2s_ease-out]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-nexus-border/30">
          <div>
            <h2 className="text-base font-semibold text-nexus-text">New Direct Message</h2>
            <p className="text-xs text-nexus-muted mt-0.5">
              Search people by username, email, or phone number
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close dialog"
            className="p-1.5 text-nexus-muted hover:text-nexus-text hover:bg-nexus-surface rounded-lg transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search Input */}
        <div className="p-4 border-b border-nexus-border/30">
          <div className="relative flex items-center">
            <Search className="absolute left-3.5 w-4 h-4 text-nexus-muted pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search username, email or phone..."
              className="w-full rounded-xl bg-nexus-surface/80 border border-nexus-border pl-10 pr-10 py-2.5 text-sm text-nexus-text placeholder:text-nexus-muted/60 outline-none focus:border-nexus-primary/50 focus:ring-[3px] focus:ring-nexus-primary/10 transition-all"
            />
            {loading ? (
              <Loader2 className="absolute right-3.5 w-4 h-4 text-nexus-primary animate-spin" />
            ) : query ? (
              <button
                type="button"
                onClick={() => handleQueryChange("")}
                className="absolute right-3 text-nexus-muted hover:text-nexus-text p-1"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
          {query.trim().length > 0 && query.trim().length < 3 && (
            <p className="text-[11px] text-nexus-muted/70 mt-2 px-1">
              Type at least 3 characters to search (use + for international phone numbers)
            </p>
          )}
        </div>

        {/* Results list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1 scrollbar-thin min-h-[220px]">
          {error && (
            <div className="p-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl text-center">
              {error}
            </div>
          )}

          {!error && !loading && hasSearched && results.length === 0 && (
            <div className="text-center py-10 px-4">
              <p className="text-sm font-medium text-nexus-muted">No users found</p>
              <p className="text-xs text-nexus-muted/60 mt-1">
                Try searching with an exact email, verified phone, or username
              </p>
            </div>
          )}

          {!hasSearched && !loading && (
            <div className="text-center py-10 px-4">
              <p className="text-xs text-nexus-muted">
                Search to start a direct conversation with anyone on Nexus
              </p>
            </div>
          )}

          {results.map((user) => {
            const maskedPhone = user.phone_number_masked || user.phone_masked
            return (
              <div
                key={user.id}
                onClick={() => {
                  onSelectUser(user)
                  handleClose()
                }}
                className="flex items-center justify-between p-2.5 rounded-xl hover:bg-nexus-surface/80 cursor-pointer transition-colors group border border-transparent hover:border-nexus-border/40"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-nexus-surface flex items-center justify-center shrink-0 border border-white/[0.06]">
                    {user.avatar_url ? (
                      <img
                        src={getImageUrl(user.avatar_url)}
                        alt={user.display_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-xs font-bold text-nexus-primary uppercase">
                        {(user.display_name || user.username || "?").charAt(0)}
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-nexus-text truncate">
                        {user.display_name}
                      </span>
                      {user.username && (
                        <span className="text-xs text-nexus-muted/70 font-mono truncate">
                          @{user.username}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[11px] text-nexus-muted">
                      {user.email_masked && (
                        <span className="flex items-center gap-1 truncate">
                          <Mail size={11} className="shrink-0 opacity-70" />
                          <span className="truncate">{user.email_masked}</span>
                        </span>
                      )}
                      {maskedPhone && (
                        <span className="flex items-center gap-1 truncate">
                          <Phone size={11} className="shrink-0 opacity-70" />
                          <span className="truncate">{maskedPhone}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Message action */}
                <button
                  type="button"
                  aria-label={`Chat with ${user.display_name}`}
                  className="shrink-0 ml-2 px-3 py-1.5 rounded-lg bg-nexus-primary/10 text-nexus-primary group-hover:bg-nexus-primary group-hover:text-white text-xs font-medium transition-all flex items-center gap-1.5"
                >
                  <MessageSquare size={13} />
                  <span>Chat</span>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body
  )
}
