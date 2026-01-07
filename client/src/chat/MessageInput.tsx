import { useState } from "react"

type Props = {
  onSend: (text: string) => void
  disabled?: boolean
  onTypingStart?: () => void
  onTypingStop?: () => void
}

export default function MessageInput({
  onSend,
  disabled,
  onTypingStart,
  onTypingStop,
}: Props) {
  const [text, setText] = useState("")
  const [isTyping, setIsTyping] = useState(false)

  let typingTimer: ReturnType<typeof setTimeout> | undefined = undefined

  const handleChange = (value: string) => {
    setText(value)

    // Start typing indicator
    if (!isTyping && value.length > 0) {
      setIsTyping(true)
      onTypingStart?.()
    }

    // Reset timer
    clearTimeout(typingTimer)

    // Stop typing after 1s of inactivity
    typingTimer = setTimeout(() => {
      setIsTyping(false)
      onTypingStop?.()
    }, 1000)
  }

  const handleSend = () => {
    if (!text.trim() || disabled) return

    clearTimeout(typingTimer)
    setIsTyping(false)
    onTypingStop?.()

    onSend(text)
    setText("")
  }

  return (
    <div className="border-t border-nexus-border bg-nexus-input/30 p-4">
      <div className="flex items-center gap-3">
        <textarea
          value={text}
          disabled={disabled}
          rows={1}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder={
            disabled ? "Nexus AI is replying…" : "Type a message..."
          }
          className="
            flex-1 resize-none rounded-xl px-4 py-3 text-sm
            bg-nexus-card text-nexus-text
            placeholder:text-nexus-muted
            outline-none border border-nexus-border
            focus:border-nexus-primary
            disabled:opacity-50
          "
        />

        <button
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          className="
            rounded-xl bg-nexus-primary px-5 py-3
            text-sm font-medium text-white
            hover:opacity-90 transition
            disabled:opacity-50 disabled:cursor-not-allowed
          "
        >
          Send
        </button>
      </div>
    </div>
  )
}