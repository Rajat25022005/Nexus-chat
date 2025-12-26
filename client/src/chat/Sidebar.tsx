export default function Sidebar() {
  return (
    <div className="w-64 border-r border-nexus-border bg-nexus-sidebar p-4">
      <h2 className="mb-4 text-lg font-semibold">Chats</h2>

      <div className="space-y-2">
        <div className="rounded-lg bg-nexus-card px-3 py-2 text-sm">
          Nexus AI
        </div>
        <div className="rounded-lg px-3 py-2 text-sm text-nexus-muted hover:bg-nexus-card">
          Research Assistant
        </div>
      </div>
    </div>
  )
}
