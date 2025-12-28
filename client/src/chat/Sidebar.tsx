import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import type { Group } from "../hooks/useWorkspace"

type Props = {
  groups: Group[]
  activeGroupId: string
  activeChatId: string
  onSelectGroup: (id: string) => void
  onSelectChat: (id: string) => void
  onNewGroup: () => void
  onNewChat: () => void
}

export default function Sidebar({
  groups,
  activeGroupId,
  activeChatId,
  onSelectGroup,
  onSelectChat,
  onNewGroup,
  onNewChat,
}: Props) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [showCreateMenu, setShowCreateMenu] = useState(false)

  return (
    <div className="flex h-full w-72 flex-col border-r border-nexus-border bg-nexus-sidebar p-4">
      {/* Groups & Chats */}
      <div className="flex-1 overflow-y-auto">
        <h2 className="mb-3 text-sm font-semibold text-nexus-muted">
          Groups
        </h2>

        {groups.map(group => (
          <div key={group.id} className="mb-4">
            {/* Group name */}
            <div
              onClick={() => onSelectGroup(group.id)}
              className={`cursor-pointer rounded px-2 py-1 text-sm font-medium transition
                ${
                  group.id === activeGroupId
                    ? "text-nexus-text"
                    : "text-nexus-muted hover:text-nexus-text"
                }`}
            >
              {group.name}
            </div>

            {/* Chats inside active group */}
            {group.id === activeGroupId && (
              <div className="ml-2 mt-2 space-y-1">
                {group.chats.map(chat => (
                  <div
                    key={chat.id}
                    onClick={() => onSelectChat(chat.id)}
                    className={`cursor-pointer rounded px-2 py-1 text-sm transition
                      ${
                        chat.id === activeChatId
                          ? "bg-nexus-card text-nexus-text"
                          : "text-nexus-muted hover:bg-nexus-card"
                      }`}
                  >
                    {chat.title}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* + New (Chat / Group) */}
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
                onClick={() => {
                  onNewChat()
                  setShowCreateMenu(false)
                }}
                className="
                  flex w-full items-center gap-2 px-3 py-2 text-sm
                  text-nexus-text
                  hover:bg-nexus-bg transition
                "
              >
                💬 New Chat
              </button>

              <button
                onClick={() => {
                  onNewGroup()
                  setShowCreateMenu(false)
                }}
                className="
                  flex w-full items-center gap-2 px-3 py-2 text-sm
                  text-nexus-text
                  hover:bg-nexus-bg transition
                "
              >
                👥 New Group
              </button>
            </div>
          )}
        </div>
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
    </div>
  )
}
