import { useState } from "react"
import Sidebar from "./Sidebar"
import ChatHeader from "./ChatHeader"
import MessageList from "./MessageList"
import MessageInput from "./MessageInput"

export type Message = {
  id: number
  text: string
  sender: "user" | "ai"
}

export default function ChatLayout() {
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, text: "Hello! How can I help you today?", sender: "ai" },
  ])

  const [isTyping, setIsTyping] = useState(false)

  const sendMessage = (text: string) => {
    // user message
    setMessages(prev => [
      ...prev,
      { id: Date.now(), text, sender: "user" },
    ])

    // AI typing starts
    setIsTyping(true)

    // fake AI response
    setTimeout(() => {
      setMessages(prev => [
        ...prev,
        {
          id: Date.now() + 1,
          text: "That’s a great question. Let me explain it simply...",
          sender: "ai",
        },
      ])
      setIsTyping(false)
    }, 1200)
  }

  return (
    <div className="flex h-screen bg-nexus-bg text-nexus-text">
      <Sidebar />

      <div className="flex flex-1 flex-col">
        <ChatHeader />
        <MessageList messages={messages} isTyping={isTyping} />
        <MessageInput onSend={sendMessage} disabled={isTyping} />
      </div>
    </div>
  )
}
