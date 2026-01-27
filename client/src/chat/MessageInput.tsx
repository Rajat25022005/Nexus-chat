import { useState } from "react"
import { Sparkles, Send } from "lucide-react"

type Props = {
  onSend: (text: string, triggerAi?: boolean) => void
  disabled?: boolean
}

export default function MessageInput({ onSend, disabled }: Props) {
  const [text, setText] = useState("")

  const handleSend = (triggerAi: boolean) => {
    if (!text.trim() || disabled) return
    onSend(text, triggerAi)
    setText("")
  }

  return (
    <div className="border-t border-nexus-border bg-nexus-input/30 p-4">
      <div className="flex items-center gap-3">
        <textarea
          value={text}
          disabled={disabled}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              handleSend(false)
            }
          }}
          placeholder={disabled ? "Nexus AI is replying…" : "Type a message..."}
          className="
            flex-1 resize-none rounded-xl px-4 py-3 text-sm
            bg-nexus-card text-nexus-text
            placeholder:text-nexus-muted
            outline-none border border-nexus-border
            focus:border-nexus-primary
            disabled:opacity-50
          "
        />

        {/* AI Button */}
        <button
          onClick={() => handleSend(true)}
          disabled={disabled || !text.trim()}
          className="
            flex items-center gap-2 rounded-xl border border-nexus-primary/50 bg-nexus-primary/10 px-4 py-3
            text-sm font-medium text-nexus-primary
            hover:bg-nexus-primary/20 transition
            disabled:opacity-50 disabled:cursor-not-allowed
          "
          title="Send and ask AI"
        >
          <Sparkles className="w-4 h-4" />
          <span className="hidden sm:inline">Ask AI</span>
        </button>

        {/* Send Button */}
        <button
          onClick={() => handleSend(false)}
          disabled={disabled || !text.trim()}
          className="
            rounded-xl bg-nexus-primary px-5 py-3
            text-sm font-medium text-white
            hover:opacity-90 transition
            disabled:opacity-50 disabled:cursor-not-allowed
          "
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
