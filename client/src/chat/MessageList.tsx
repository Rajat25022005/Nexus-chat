import { useEffect, useRef } from "react"
import MessageBubble from "./MessageBubble"
import type { Message } from "./ChatLayout"

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
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isTyping && (
          <div className="text-sm text-nexus-muted italic">
            Nexus AI is typing…
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}
