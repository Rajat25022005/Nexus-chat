import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useState } from 'react'

import type { Message } from "../hooks/useWorkspace"

const CodeBlockHeader = ({ language, code }: { language: string, code: string }) => {
  const [isCopied, setIsCopied] = useState(false)

  const handleCopy = () => {
    if (!code) return
    navigator.clipboard.writeText(code)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }

  return (
    <div className="bg-[#1e1e1e] px-3 py-1 text-xs text-gray-400 border-b border-white/5 flex justify-between items-center select-none">
      <span className="lowercase">{language}</span>
      <button
        onClick={handleCopy}
        className="hover:text-white transition-colors cursor-pointer flex items-center gap-1"
        aria-label="Copy code to clipboard"
      >
        {isCopied ? (
          <span className="text-green-400 font-medium">Copied!</span>
        ) : (
          <span>Copy</span>
        )}
      </button>
    </div>
  )
}
const COLORS = [
  "#e542a3", "#02a698", "#e91e63", "#9c27b0", "#673ab7", "#3f51b5",
  "#2196f3", "#00bcd4", "#009688", "#4caf50", "#8bc34a", "#cddc39",
  "#ffeb3b", "#ffc107", "#ff9800", "#ff5722", "#795548", "#607d8b"
]

const getSenderColor = (sender?: string) => {
  if (!sender) return "#34b7f1"
  let hash = 0
  for (let i = 0; i < sender.length; i++) {
    hash = sender.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash % COLORS.length)
  return COLORS[index]
}

export default function MessageBubble({ message, currentUserId }: { message: Message, currentUserId: string }) {
  // Strict check: It is me only if sender matches currentUserId. 
  // If sender is undefined, we assume it's NOT me (unless we are sure otherwise, but safer to assume other).
  // Ideally all messages should have sender now.
  const isMe = message.role === "user" && message.sender === currentUserId
  const isOtherUser = message.role === "user" && !isMe

  // Determine alignment
  // Me -> Right
  // Others / AI -> Left
  const alignClass = isMe ? "justify-end" : "justify-start"

  // Background
  // Me -> Primary
  // Others / AI -> Card
  // (bgClass variable removed as it was unused, logic moved to bubbleContentClass)

  // For other users, maybe give them a slightly different style or just the label?
  // Let's keep the card style for them but add padding since they are plain text usually?
  // Wait, other users messages are plain text (unless we support markdown for them too).
  // Current AI has "markdown-container". User messages have "whitespace-pre-wrap".
  // Let's assume other users send plain text for now, similar to "me".

  // WhatsApp Style Colors (Dark Mode)
  // Me -> #005c4b (Dark Green)
  // Others -> #202c33 (Dark Gray)

  const bubbleContentClass = isMe
    ? "bg-[#005c4b] text-[#e9edef] rounded-lg rounded-tr-none px-3 py-1.5 shadow-sm max-w-[85%]" // Message tail effect top-right
    : isOtherUser
      ? "bg-[#202c33] text-[#e9edef] rounded-lg rounded-tl-none px-3 py-1.5 shadow-sm max-w-[85%]" // Message tail effect top-left
      : "bg-[#102420] text-[#e9edef] rounded-lg rounded-tl-none p-0 shadow-sm max-w-[85%]" // AI - Dark Teal

  return (
    <div className={`flex flex-col mb-2 ${isMe ? "items-end" : "items-start"}`}>
      <div className={`flex w-full ${alignClass}`}>
        <div
          className={bubbleContentClass}
        >
          {/* Sender Label INSIDE the bubble for others and AI */}
          {(isOtherUser || message.role === "assistant") && (
            <div
              className="text-xs font-bold mb-1"
              style={{ color: message.role === "assistant" ? "#06cf9c" : getSenderColor(message.sender) }}
            >
              {message.role === "assistant" ? "Nexus AI" : (message.sender_name || message.sender)}
            </div>
          )}

          {message.role === "assistant" ? (
            <div className="markdown-container px-4 py-2">
              <ReactMarkdown
                components={{
                  code({ node, inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || '')
                    const codeContent = String(children).replace(/\n$/, '')

                    return !inline && match ? (
                      <div className="my-3 rounded-md overflow-hidden border border-white/10">
                        <CodeBlockHeader language={match[1]} code={codeContent} />
                        <SyntaxHighlighter
                          style={vscDarkPlus}
                          language={match[1]}
                          PreTag="div"
                          customStyle={{ margin: 0, borderRadius: 0, fontSize: '13px' }}
                          {...props}
                        >
                          {codeContent}
                        </SyntaxHighlighter>
                      </div>
                    ) : (
                      <code
                        className="bg-black/30 text-red-400 rounded px-1.5 py-0.5 font-mono text-xs"
                        {...props}
                      >
                        {children}
                      </code>
                    )
                  }
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          ) : (
            // User (Me or Other)
            <div className="whitespace-pre-wrap text-[15px] leading-relaxed relative pb-1">
              {message.content}
              {/* Tiny timestamp placeholder if we had it, but for now just text */}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}