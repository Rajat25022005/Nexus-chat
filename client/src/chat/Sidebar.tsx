import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import type { Group } from "../hooks/useWorkspace"
import Modal from "../components/Modal"

type Props = {
  groups: Group[]
  activeGroupId: string
  activeChatId: string
  onSelectGroup: (id: string) => void
  onSelectChat: (id: string) => void
  onNewGroup: (name: string) => void
  onNewChat: (title: string) => void
  onJoinGroup: (groupId: string) => void
  userEmail: string
  onDeleteGroup: (id: string) => void
  onDeleteChat: (groupId: string, chatId: string) => void
}

export default function Sidebar({
  groups,
  activeGroupId,
  activeChatId,
  onSelectGroup,
  onSelectChat,
  onNewGroup,
  onNewChat,
  onJoinGroup,
  userEmail,
  onDeleteGroup,
  onDeleteChat,
}: Props) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [showCreateMenu, setShowCreateMenu] = useState(false)

  // Modal States
  const [modalType, setModalType] = useState<"group" | "chat" | "join" | null>(null)
  const [inputValue, setInputValue] = useState("")

  const openModal = (type: "group" | "chat" | "join") => {
    setModalType(type)
    setInputValue("")
    setShowCreateMenu(false)
  }

  const handleModalSubmit = () => {
    if (!inputValue.trim()) return

    if (modalType === "group") onNewGroup(inputValue)
    else if (modalType === "chat") onNewChat(inputValue)
    else if (modalType === "join") onJoinGroup(inputValue)

    setModalType(null)
  }

  return (
    <div className="flex h-full w-72 flex-col border-r border-nexus-border bg-nexus-sidebar p-4">
      {/* Groups & Chats */}
      <div className="flex-1 overflow-y-auto">
        <h2 className="mb-3 text-sm font-semibold text-nexus-muted">
          Groups
        </h2>

        {groups.map(group => {
          const isPersonal = group.id.startsWith("personal_")
          const isOwner = group.user_id === userEmail

          return (
            <div key={group.id} className="mb-4">
              {/* Group name + Delete Helper */}
              <div className="flex items-center justify-between group/item">
                <div
                  onClick={() => onSelectGroup(group.id)}
                  className={`flex-1 cursor-pointer rounded px-2 py-1 text-sm font-medium transition
                    ${group.id === activeGroupId
                      ? "text-nexus-text"
                      : "text-nexus-muted hover:text-nexus-text"
                    }`}
                >
                  {group.name}
                </div>
                {/* Delete Group Button: Only for Owner & Not Personal */}
                {isOwner && !isPersonal && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteGroup(group.id) }}
                    className="opacity-0 group-hover/item:opacity-100 text-red-400 hover:text-red-500 p-1"
                    title="Delete Group"
                  >
                    🗑️
                  </button>
                )}
              </div>

              {/* Chats inside active group */}
              {group.id === activeGroupId && (
                <div className="ml-2 mt-2 space-y-1">
                  {group.chats.map(chat => (
                    <div
                      key={chat.id}
                      onClick={() => onSelectChat(chat.id)}
                      className={`flex items-center justify-between cursor-pointer rounded px-2 py-1 text-sm transition group/chat
                      ${chat.id === activeChatId
                          ? "bg-nexus-card text-nexus-text"
                          : "text-nexus-muted hover:bg-nexus-card"
                        }`}
                    >
                      <span className="truncate">{chat.title}</span>
                      {/* Delete Chat Button: For Owner OR Personal Owner */}
                      {/* Note: Logic simplifies to: if group owner is me, I can delete any chat. */}
                      {(isOwner || isPersonal) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDeleteChat(group.id, chat.id) }}
                          className="opacity-0 group-hover/chat:opacity-100 text-xs text-red-400 hover:text-red-500 px-1"
                          title="Delete Chat"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Members List (for active group) */}
              {group.id === activeGroupId && group.members && group.members.length > 0 && (
                <div className="ml-2 mt-3 border-t border-nexus-border pt-2">
                  <p className="mb-1 px-2 text-xs font-semibold text-nexus-muted uppercase">Members</p>
                  {group.members.map(member => (
                    <div key={member} className="px-2 py-0.5 text-xs text-nexus-muted truncate" title={member}>
                      {member}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* + New (Chat / Group / Join) */}
        <div className="relative mt-4">
          <button
            onClick={() => setShowCreateMenu(prev => !prev)}
            className="
              flex w-full items-center justify-center gap-2
              rounded-lg border border-nexus-border
              py-2 text-sm
              text-nexus-text
              hover:bg-nexus-card
              transition
            "
          >
            <span className="text-base">＋</span>
            New
          </button>

          {showCreateMenu && (
            <div
              className="
                absolute left-0 right-0 top-full z-10 mt-2
                rounded-lg border border-nexus-border
                bg-nexus-card shadow-lg
                overflow-hidden
              "
            >
              <button
                onClick={() => openModal("chat")}
                className="
                  flex w-full items-center gap-2 px-3 py-2 text-sm
                  text-nexus-text
                  hover:bg-nexus-bg transition
                "
              >
                💬 New Chat
              </button>

              <button
                onClick={() => openModal("group")}
                className="
                  flex w-full items-center gap-2 px-3 py-2 text-sm
                  text-nexus-text
                  hover:bg-nexus-bg transition
                "
              >
                👥 New Group
              </button>

              <button
                onClick={() => openModal("join")}
                className="
                  flex w-full items-center gap-2 px-3 py-2 text-sm
                  text-nexus-text
                  hover:bg-nexus-bg transition
                "
              >
                🔗 Join Group
              </button>
            </div>
          )}
        </div>

        {/* Active Group ID Display */}
        {activeGroupId !== "personal" && (
          <div className="mt-4 p-2 rounded bg-nexus-card border border-nexus-border">
            <p className="text-xs text-nexus-muted">Group ID (Share to invite):</p>
            <p
              className="text-xs font-mono select-all cursor-pointer hover:text-nexus-primary"
              onClick={() => navigator.clipboard.writeText(activeGroupId)}
              title="Click to copy"
            >
              {activeGroupId}
            </p>
          </div>
        )}
      </div>

      {/* Logout */}
      <button
        onClick={() => {
          logout()
          navigate("/login")
        }}
        className="
          mt-4 rounded-lg
          border border-nexus-border
          py-2 text-sm
          text-red-400
          hover:bg-red-500/10
          transition
        "
      >
        Logout
      </button>

      {/* MODAL */}
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
            <p className="text-sm text-nexus-muted">
              Enter the unique Group ID shared by the admin.
            </p>
          )}

          <input
            autoFocus
            type="text"
            className="w-full rounded bg-nexus-bg border border-nexus-border px-3 py-2 text-nexus-text focus:border-nexus-primary focus:outline-none"
            placeholder={
              modalType === "group" ? "Group Name..." :
                modalType === "chat" ? "Chat Title..." :
                  "Group ID..."
            }
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleModalSubmit()}
          />

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setModalType(null)}
              className="px-3 py-1.5 rounded text-sm text-nexus-muted hover:bg-nexus-bg transition"
            >
              Cancel
            </button>
            <button
              onClick={handleModalSubmit}
              className="px-3 py-1.5 rounded text-sm bg-nexus-primary text-white hover:bg-red-700 transition"
            >
              {modalType === "join" ? "Join" : "Create"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
