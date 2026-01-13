import logo from "../assets/logo.svg"

type Props = {
  title: string
  isConnected?: boolean
}

export default function ChatHeader({ title, isConnected = true }: Props) {
  return (
    <div className="flex items-center gap-3 border-b border-nexus-border bg-nexus-header px-6 py-4">
      <img
        src={logo}
        alt="Nexus"
        className="h-8 w-8 rounded-md bg-nexus-primary p-1"
      />
      <div className="flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-xs text-nexus-muted">
          {isConnected ? (
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-green-500"></span>
              Online
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-red-500"></span>
              Offline
            </span>
          )}
        </p>
      </div>
    </div>
  )
}
