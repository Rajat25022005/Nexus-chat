import { useEffect, useRef } from "react"
import MessageBubble from "./MessageBubble"
import type { Message } from "../hooks/useWorkspace"

type Props = {
  messages: Message[]
  isTyping: boolean
}

export default function MessageList({ messages, isTyping }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isTyping])

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      <div className="flex flex-col gap-3">
        {messages.length === 0 && !isTyping && (
          <div className="mt-20 text-center text-nexus-muted">
            Ask Nexus anything…
          </div>
        )}

        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isTyping && (
          <div className="flex items-center gap-2 text-sm text-nexus-muted">
            <span className="animate-pulse">●</span>
            <span className="animate-pulse delay-150">●</span>
            <span className="animate-pulse delay-300">●</span>
          </div>
        )}


        <div ref={bottomRef} />
      </div>
    </div>
  )
}
