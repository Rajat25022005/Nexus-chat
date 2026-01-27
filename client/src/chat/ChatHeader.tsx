import logo from "../assets/logo.svg"
import { Menu } from "lucide-react"

type Props = {
  title: string
  onToggleSidebar: () => void
  onOpenDetails: () => void
}

export default function ChatHeader({ title, onToggleSidebar, onOpenDetails }: Props) {
  return (
    <div className="flex items-center justify-between border-b border-nexus-border bg-nexus-header px-6 py-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="mr-2 text-nexus-muted hover:text-nexus-text transition"
        >
          <Menu className="h-6 w-6" />
        </button>
        <img
          src={logo}
          alt="Nexus"
          className="h-8 w-8 rounded-md bg-nexus-primary p-1"
        />
        <div>
          <p className="font-medium">{title}</p>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <p className="text-xs text-nexus-muted">Online</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onOpenDetails}
          className="text-nexus-muted hover:text-nexus-text p-2 rounded hover:bg-nexus-card transition"
          title="Group Info"
        >
          ℹ️
        </button>
      </div>
    </div>
  )
}
