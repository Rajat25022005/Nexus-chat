import { useEffect, useRef } from "react"
import MessageBubble from "./MessageBubble"
import type { Message } from "../hooks/useWorkspace"

type Props = {
  messages: Message[]
  isTyping: boolean
  typingUsers?: string[]
}

export default function MessageList({
  messages,
  isTyping,
  typingUsers = [],
}: Props) {
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
          <div className="flex items-start gap-3">
            <div className="flex items-center gap-2 rounded-xl bg-nexus-card px-4 py-3 text-sm text-nexus-muted">
              {typingUsers.length > 0 ? (
                <>
                  <span className="font-medium">
                    {typingUsers.join(", ")}
                  </span>
                  <span>
                    {typingUsers.length === 1 ? "is" : "are"} typing
                  </span>
                </>
              ) : (
                <span>AI is thinking</span>
              )}
              <span className="flex gap-1">
                <span className="animate-pulse">●</span>
                <span className="animate-pulse delay-150">●</span>
                <span className="animate-pulse delay-300">●</span>
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}