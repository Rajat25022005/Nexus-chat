import { memo } from "react"
import { Menu, Info, Search, Users, Sun, Moon } from "lucide-react"
import { useThemeStore } from "../stores/themeStore"

type Props = {
  title: string
  groupName: string
  typingUser?: { name: string; isAi: boolean } | null
  onToggleSidebar: () => void
  onToggleInfo: () => void
  onOpenDetails: () => void
  onOpenCommandPalette: () => void
}

const ChatHeader = memo(function ChatHeader({
  title,
  groupName,
  typingUser,
  onToggleSidebar,
  onToggleInfo,
  onOpenDetails,
  onOpenCommandPalette,
}: Props) {
  const { resolvedTheme, toggleTheme } = useThemeStore()

  return (
    <div className="flex items-center justify-between border-b border-nexus-border bg-nexus-header backdrop-blur-xl px-4 md:px-5 h-14 shrink-0 z-10 transition-colors duration-200">
      {/* Left */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Toggle navigation sidebar"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 -ml-2 text-nexus-muted hover:text-nexus-text hover:bg-nexus-surface rounded-xl transition-all duration-200 md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="min-w-0">
          <p className="font-semibold text-sm leading-tight truncate max-w-[200px] sm:max-w-[300px]">
            {title || "Chat"}
          </p>
          {typingUser ? (
            <p className="text-[11px] text-nexus-primary font-medium animate-pulse truncate">
              {typingUser.isAi ? "Nexus AI is thinking..." : `${typingUser.name} is typing...`}
            </p>
          ) : groupName ? (
            <p className="text-[11px] text-nexus-muted truncate">{groupName}</p>
          ) : null}
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-1">
        {/* Quick Theme Toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 text-nexus-muted hover:text-nexus-text hover:bg-nexus-surface rounded-xl transition-all duration-200"
          title={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
        >
          {resolvedTheme === "dark" ? (
            <Sun className="w-[18px] h-[18px] hover:text-amber-400 transition-colors" />
          ) : (
            <Moon className="w-[18px] h-[18px] hover:text-indigo-600 transition-colors" />
          )}
        </button>

        <button
          type="button"
          onClick={onOpenCommandPalette}
          aria-label="Search channels, workspaces, or actions"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 text-nexus-muted hover:text-nexus-text hover:bg-nexus-surface rounded-xl transition-all duration-200 gap-1.5"
          title="Search (⌘K)"
        >
          <Search className="w-[18px] h-[18px]" />
          <kbd className="hidden lg:inline-flex text-[9px] bg-nexus-surface/80 px-1.5 py-0.5 rounded text-nexus-muted/70 border border-nexus-border/50 font-mono">
            ⌘K
          </kbd>
        </button>
        <button
          type="button"
          onClick={onOpenDetails}
          aria-label="View workspace members and details"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 text-nexus-muted hover:text-nexus-text hover:bg-nexus-surface rounded-xl transition-all duration-200"
          title="Members"
        >
          <Users className="w-[18px] h-[18px]" />
        </button>
        <button
          type="button"
          onClick={onToggleInfo}
          aria-label="Toggle conversation details panel"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 text-nexus-muted hover:text-nexus-text hover:bg-nexus-surface rounded-xl transition-all duration-200 hidden md:flex"
          title="Info"
        >
          <Info className="w-[18px] h-[18px]" />
        </button>
      </div>
    </div>
  )
})

export default ChatHeader
