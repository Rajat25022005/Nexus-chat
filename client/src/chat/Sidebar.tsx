import { useState, useCallback, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { Settings, Plus, ChevronDown, ChevronRight, Hash, LogOut, User, Sun, Moon } from "lucide-react"
import { useAuthStore } from "../stores/authStore"
import { useThemeStore } from "../stores/themeStore"
import { usePresenceStore } from "../stores/presenceStore"
import { decodeToken } from "../lib/token"
import { getImageUrl } from "../api/config"
import Modal from "../components/Modal"
import NexusAvatar from "../components/ui/NexusAvatar"
import type { Group, DirectChat } from "../types"

type Props = {
  groups: Group[]
  directChats?: DirectChat[]
  activeGroupId: string
  activeChatId: string
  onlineUserIds?: Set<string>
  onSelectGroup: (id: string) => void
  onSelectChat: (id: string) => void
  onSelectDirectChat?: (id: string) => void
  onOpenUserSearch?: () => void
  onNewGroup: (name: string) => void
  onNewChat: (title: string) => void
  onJoinGroup: (groupId: string) => void
  onDeleteGroup: (id: string) => void
  onDeleteChat: (groupId: string, chatId: string) => void
  onDeleteDirectChat?: (chatId: string) => void
  userEmail: string
}

export default function Sidebar({
  groups,
  directChats = [],
  activeGroupId,
  activeChatId,
  onlineUserIds,
  onSelectGroup,
  onSelectChat,
  onSelectDirectChat,
  onOpenUserSearch,
  onNewGroup,
  onNewChat,
  onJoinGroup,
  onDeleteGroup,
  onDeleteChat,
  onDeleteDirectChat,
  userEmail,
}: Props) {
  const navigate = useNavigate()
  const { logout, token } = useAuthStore()
  const { resolvedTheme, toggleTheme } = useThemeStore()
  const storeOnlineUsers = usePresenceStore((s) => s.onlineUserIds)
  const activeOnlineSet = onlineUserIds || storeOnlineUsers

  const currentUserId = useMemo(() => {
    const decoded = decodeToken(token)
    return decoded?.user_id || decoded?.sub || ""
  }, [token])
  const [showCreateMenu, setShowCreateMenu] = useState(false)
  const [modalType, setModalType] = useState<"group" | "chat" | "join" | null>(null)
  const [inputValue, setInputValue] = useState("")
  const [dmCollapsed, setDmCollapsed] = useState(false)

  const openModal = useCallback((type: "group" | "chat" | "join") => {
    setModalType(type)
    setInputValue("")
    setShowCreateMenu(false)
  }, [])

  const handleModalSubmit = useCallback(() => {
    if (!inputValue.trim()) return
    if (modalType === "group") onNewGroup(inputValue)
    else if (modalType === "chat") onNewChat(inputValue)
    else if (modalType === "join") onJoinGroup(inputValue)
    setModalType(null)
  }, [inputValue, modalType, onNewGroup, onNewChat, onJoinGroup])

  return (
    <div className="flex h-full w-[280px] md:w-[260px] flex-col border-r border-nexus-border bg-nexus-sidebar backdrop-blur-xl relative z-40">
      {/* Header */}
      <div className="h-14 flex items-center px-4 border-b border-nexus-border shrink-0">
        <h2 className="text-sm font-bold tracking-tight text-nexus-text/90">Workspaces</h2>
      </div>

      {/* Groups & Direct Messages */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3 scrollbar-thin">
        {groups.length === 0 && (
          <div className="text-center py-6 px-4">
            <p className="text-xs text-nexus-muted">No workspaces yet</p>
            <p className="text-[10px] text-nexus-muted/60 mt-1">Create one to get started</p>
          </div>
        )}

        {groups.map((group) => {
          const isPersonal = group.id.startsWith("personal_")
          const isOwner = Boolean(
            (group.owner_id && currentUserId && group.owner_id === currentUserId) ||
            (group.user_id && (group.user_id === userEmail || (currentUserId && group.user_id === currentUserId)))
          )
          const isActive = group.id === activeGroupId

          return (
            <div key={group.id} className="mb-0.5">
              {/* Group row */}
              <div
                role="button"
                tabIndex={0}
                aria-expanded={isActive}
                aria-label={`Workspace ${group.name}`}
                className={`
                  flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer
                  transition-all duration-150 group focus:outline-none focus-visible:ring-2 focus-visible:ring-nexus-primary/50
                  ${isActive ? "bg-nexus-primary/10" : "hover:bg-nexus-hover"}
                `}
                onClick={() => onSelectGroup(group.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onSelectGroup(group.id)
                  }
                }}
              >
                {/* Expand/collapse chevron */}
                <button
                  type="button"
                  aria-label={isActive ? `Collapse ${group.name}` : `Expand ${group.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isActive) onSelectGroup("") // collapse
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="text-nexus-muted/50 hover:text-nexus-muted transition-colors"
                >
                  {isActive ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </button>

                {/* Group avatar */}
                <div
                  className={`
                    w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0
                    ${isActive ? "bg-nexus-primary/20 text-nexus-primary" : "bg-nexus-surface text-nexus-muted"}
                  `}
                >
                  {isPersonal ? <User className="w-3.5 h-3.5" /> : group.name.charAt(0).toUpperCase()}
                </div>

                {/* Group name */}
                <span className={`text-[13px] font-medium truncate flex-1 ${isActive ? "text-nexus-primary" : "text-nexus-text/80"}`}>
                  {group.name}
                </span>

                {/* Delete button */}
                {isOwner && !isPersonal && (
                  <button
                    type="button"
                    aria-label={`Delete workspace ${group.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteGroup(group.id)
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus:opacity-100 text-red-400/70 hover:text-red-400 p-1 rounded transition-all"
                    title="Delete"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                    </svg>
                  </button>
                )}
              </div>

              {/* Chat list (expanded) */}
              {isActive && (
                <div className="ml-6 border-l border-nexus-border/30 pl-2 mt-0.5 space-y-0.5">
                  {group.chats.map((chat) => (
                    <div
                      key={chat.id}
                      role="button"
                      tabIndex={0}
                      aria-selected={chat.id === activeChatId}
                      aria-label={`Channel #${chat.title}`}
                      onClick={() => onSelectChat(chat.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          onSelectChat(chat.id)
                        }
                      }}
                      className={`
                        flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] cursor-pointer
                        transition-all duration-150 group/chat focus:outline-none focus-visible:ring-2 focus-visible:ring-nexus-primary/50
                        ${chat.id === activeChatId
                          ? "bg-nexus-surface text-nexus-text font-medium"
                          : "text-nexus-muted/70 hover:bg-nexus-hover/50 hover:text-nexus-text/80"
                        }
                      `}
                    >
                      <Hash className="w-3 h-3 opacity-40" />
                      <span className="truncate flex-1">{chat.title}</span>
                      {(isOwner || isPersonal) && (
                        <button
                          type="button"
                          aria-label={`Delete chat channel ${chat.title}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeleteChat(group.id, chat.id)
                          }}
                          onKeyDown={(e) => e.stopPropagation()}
                          className="opacity-0 group-hover/chat:opacity-100 focus-visible:opacity-100 focus:opacity-100 text-red-400/60 hover:text-red-400 p-0.5 rounded transition-all"
                          title="Delete"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6L6 18M6 6l12 12"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* Dedicated Collapsible Direct Messages Section */}
        <div className="mt-4 pt-3 border-t border-nexus-border/30">
          <div className="flex items-center justify-between px-2 mb-1.5">
            <button
              type="button"
              onClick={() => setDmCollapsed((p) => !p)}
              className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-nexus-muted/70 hover:text-nexus-text transition-colors"
              aria-label={dmCollapsed ? "Expand Direct Messages" : "Collapse Direct Messages"}
            >
              {dmCollapsed ? (
                <ChevronRight className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
              <span>Direct Messages</span>
            </button>
            <button
              type="button"
              onClick={onOpenUserSearch}
              className="p-1 rounded-md text-nexus-muted/70 hover:text-nexus-text hover:bg-nexus-surface transition-colors"
              aria-label="New direct message"
              title="Find people"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {!dmCollapsed && (
            <div className="space-y-0.5">
              {directChats.length === 0 ? (
                <p className="px-2 py-1.5 text-[11px] text-nexus-muted/50 italic">
                  No direct messages yet
                </p>
              ) : (
                directChats.map((dc) => {
                  const isActive = dc.chat_id === activeChatId
                  return (
                    <div
                      key={dc.chat_id}
                      role="button"
                      tabIndex={0}
                      aria-selected={isActive}
                      aria-label={`Direct message with ${dc.recipient.display_name}`}
                      onClick={() => (onSelectDirectChat ? onSelectDirectChat(dc.chat_id) : onSelectChat(dc.chat_id))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          if (onSelectDirectChat) onSelectDirectChat(dc.chat_id)
                          else onSelectChat(dc.chat_id)
                        }
                      }}
                      className={`
                        flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] cursor-pointer
                        transition-all duration-150 group/dm focus:outline-none focus-visible:ring-2 focus-visible:ring-nexus-primary/50
                        ${isActive
                          ? "bg-nexus-surface text-nexus-text font-medium"
                          : "text-nexus-muted/70 hover:bg-nexus-hover/50 hover:text-nexus-text/80"
                        }
                      `}
                    >
                      {/* Avatar */}
                      <NexusAvatar
                        src={dc.recipient.avatar_url ? getImageUrl(dc.recipient.avatar_url) : undefined}
                        name={dc.recipient.display_name || dc.recipient.username}
                        size="sm"
                        online={activeOnlineSet.has(dc.recipient.id)}
                      />

                      {/* Name / Username */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate leading-tight font-medium">
                          {dc.recipient.display_name}
                        </p>
                        {dc.recipient.username && (
                          <p className="text-[10px] text-nexus-muted/60 truncate font-mono">
                            @{dc.recipient.username}
                          </p>
                        )}
                      </div>

                      {/* Unread badge */}
                      {(dc.unread_count || 0) > 0 && !isActive && (
                        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-nexus-primary text-white rounded-full">
                          {dc.unread_count}
                        </span>
                      )}

                      {/* Delete button */}
                      {onDeleteDirectChat && (
                        <button
                          type="button"
                          aria-label={`Close chat with ${dc.recipient.display_name}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeleteDirectChat(dc.chat_id)
                          }}
                          onKeyDown={(e) => e.stopPropagation()}
                          className="opacity-0 group-hover/dm:opacity-100 focus-visible:opacity-100 text-red-400/60 hover:text-red-400 p-0.5 rounded transition-all"
                          title="Close chat"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6L6 18M6 6l12 12"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>

        {/* New button */}
        <div className="relative mt-3 px-1">
          <button
            type="button"
            aria-label="Create or join workspace/chat"
            onClick={() => setShowCreateMenu((p) => !p)}
            className="
              flex w-full items-center justify-center gap-2
              rounded-lg bg-nexus-primary/90 py-2 text-xs font-semibold text-white
              hover:bg-nexus-primary hover:shadow-[0_0_15px_rgba(164,22,26,0.25)]
              active:scale-[0.98] transition-all duration-200
            "
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </button>

          {showCreateMenu && (
            <div className="
              absolute left-0 right-0 top-full z-10 mt-1.5
              rounded-xl border border-nexus-border/50
              bg-nexus-card/95 backdrop-blur-xl shadow-xl overflow-hidden
            ">
              {[
                { type: "chat" as const, icon: "💬", label: "New Chat" },
                { type: "group" as const, icon: "👥", label: "New Group" },
                { type: "join" as const, icon: "🔗", label: "Join Group" },
              ].map((item) => (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => openModal(item.type)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-nexus-text/80 hover:bg-nexus-primary/10 hover:text-nexus-primary transition-colors"
                >
                  <span aria-hidden="true">{item.icon}</span> {item.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Invite Code (share) */}
        {activeGroupId && !activeGroupId.startsWith("personal") && (() => {
          const group = groups.find((g) => g.id === activeGroupId)
          const inviteCode = group?.invite_code
          if (!inviteCode) return null
          return (
            <div className="mt-4 mx-1 p-2.5 rounded-lg bg-nexus-card/40 border border-nexus-border/30">
              <p className="text-[9px] uppercase tracking-wider text-nexus-muted/60 font-semibold mb-1">
                Invite Code (click to copy)
              </p>
              <button
                type="button"
                aria-label={`Copy invite code ${inviteCode}`}
                className="text-sm font-mono font-bold text-nexus-primary/80 hover:text-nexus-primary transition-colors cursor-pointer select-all tracking-widest text-left"
                onClick={() => navigator.clipboard.writeText(inviteCode)}
              >
                {inviteCode}
              </button>
            </div>
          )
        })()}
      </div>

      {/* Footer */}
      <div className="shrink-0 p-2.5 border-t border-nexus-border">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Open settings"
            onClick={() => navigate("/settings")}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium text-nexus-muted hover:bg-nexus-hover hover:text-nexus-text transition-all"
          >
            <Settings className="w-3.5 h-3.5" />
            Settings
          </button>
          <button
            type="button"
            aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
            onClick={toggleTheme}
            className="p-2 rounded-lg text-nexus-muted hover:bg-nexus-hover hover:text-nexus-text transition-all"
            title={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
          >
            {resolvedTheme === "dark" ? (
              <Sun className="w-3.5 h-3.5 hover:text-amber-400 transition-colors" />
            ) : (
              <Moon className="w-3.5 h-3.5 hover:text-indigo-600 transition-colors" />
            )}
          </button>
          <button
            type="button"
            aria-label="Sign out of account"
            onClick={() => { logout(); navigate("/login") }}
            className="flex items-center justify-center p-2 rounded-lg text-nexus-muted hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400 transition-all"
            title="Log out"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Modal */}
      <Modal
        isOpen={!!modalType}
        onClose={() => setModalType(null)}
        title={
          modalType === "group" ? "Create New Group" :
          modalType === "chat" ? "Create New Chat" :
          modalType === "join" ? "Join Group" : ""
        }
      >
        <div className="flex flex-col gap-4">
          {modalType === "join" && (
            <p className="text-sm text-nexus-muted">Enter the invite code shared by the group admin (e.g. NX7K-Q2R9).</p>
          )}
          <input
            autoFocus
            type="text"
            aria-label={
              modalType === "group" ? "Group Name" :
              modalType === "chat" ? "Chat Title" : "Invite Code"
            }
            className="w-full rounded-xl bg-nexus-bg border border-nexus-border px-4 py-3 text-nexus-text text-sm focus:border-nexus-primary/50 focus:outline-none focus:ring-[3px] focus:ring-nexus-primary/10 transition-all"
            placeholder={
              modalType === "group" ? "Group Name..." :
              modalType === "chat" ? "Chat Title..." : "Invite Code (e.g. NX7K-Q2R9)"
            }
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleModalSubmit()}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setModalType(null)}
              className="px-4 py-2 rounded-xl text-sm text-nexus-muted hover:bg-nexus-bg transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleModalSubmit}
              className="px-4 py-2 rounded-xl text-sm bg-nexus-primary text-white hover:brightness-110 transition-all font-medium"
            >
              {modalType === "join" ? "Join" : "Create"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
