import { useState } from "react"

type Props = {
  onSend: (text: string) => void
  disabled?: boolean
}

export default function MessageInput({ onSend, disabled }: Props) {
  const [text, setText] = useState("")

  const handleSend = () => {
    if (!text.trim() || disabled) return
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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              handleSend()
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

        <button
          onClick={handleSend}
          disabled={disabled}
          className="
            rounded-xl bg-nexus-primary px-5 py-3
            text-sm font-medium text-white
            hover:opacity-90 transition
            disabled:opacity-50
          "
        >
          Send
        </button>
      </div>
    </div>
  )
}
