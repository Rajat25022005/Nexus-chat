import logo from "../assets/logo.svg"

export default function ChatHeader() {
  return (
    <div className="flex items-center gap-3 border-b border-nexus-border bg-nexus-header px-6 py-4">
      <img
        src={logo}
        alt="Nexus"
        className="h-8 w-8 rounded-md bg-nexus-primary p-1"
      />
      <div>
        <p className="font-medium">Nexus AI</p>
        <p className="text-xs text-nexus-muted">Online</p>
      </div>
    </div>
  )
}
