import type { Message } from "./ChatLayout"

export default function MessageBubble({ message }: { message: Message }) {
  const isUser = message.sender === "user"

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`
          max-w-[70%] px-4 py-2 rounded-xl text-sm
          ${
            isUser
              ? "bg-nexus-primary text-white rounded-br-sm"
              : "bg-nexus-card text-nexus-text rounded-bl-sm"
          }
        `}
      >
        {message.text}
      </div>
    </div>
  )
}
