import logo from "../assets/logo.svg"

type Props = {
  title: string
  isAiDisabled: boolean
  onToggleAi: () => void
}

export default function ChatHeader({ title, isAiDisabled, onToggleAi }: Props) {
  return (
    <div className="flex items-center justify-between border-b border-nexus-border bg-nexus-header px-6 py-4">
      <div className="flex items-center gap-3">
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
        <label className="flex items-center gap-2 text-sm text-nexus-text cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!isAiDisabled}
            onChange={onToggleAi}
            className="accent-nexus-primary w-4 h-4 cursor-pointer"
          />
          <span>AI Assistant</span>
        </label>
      </div>
    </div>
  )
}
