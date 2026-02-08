import { useState } from "react"
import { Sparkles, Send } from "lucide-react"

type Props = {
  onSend: (text: string, triggerAi?: boolean) => void
  disabled?: boolean
  replyingTo?: any // Using any for now to match ChatLayout
  onCancelReply?: () => void
}

export default function MessageInput({ onSend, disabled, replyingTo, onCancelReply }: Props) {
  const [text, setText] = useState("")

  const handleSend = (triggerAi: boolean) => {
    if (!text.trim() || disabled) return
    onSend(text, triggerAi)
    setText("")
  }

  return (
    <div className="border-t border-nexus-border bg-nexus-input/30 p-4">
      {replyingTo && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-nexus-card border border-nexus-primary/20 p-2 pl-3 relative overflow-hidden">
          <div className="w-1 absolute left-0 top-0 bottom-0 bg-nexus-primary" />
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className="text-xs font-bold text-nexus-primary">
              Replying to {replyingTo.sender_name || replyingTo.sender}
            </span>
            <span className="text-xs text-nexus-muted truncate">
              {replyingTo.content}
            </span>
          </div>
          <button
            onClick={onCancelReply}
            className="ml-2 p-1 hover:bg-white/5 rounded-full text-nexus-muted hover:text-white transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      )}
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
