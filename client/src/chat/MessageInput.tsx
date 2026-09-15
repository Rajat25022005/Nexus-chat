import { useState, useCallback, useRef, useEffect } from "react"
import { Sparkles, Send, X, Paperclip, Loader2 } from "lucide-react"
import { socket } from "../socket"
import SlashCommandMenu, { getFilteredCommands, type SlashCommand } from "./SlashCommandMenu"
import { uploadFile } from "../api/files"
import type { Message } from "../types"

type Props = {
  onSend: (text: string, triggerAi?: boolean) => void
  disabled?: boolean
  replyingTo?: Message | null
  onCancelReply?: () => void
  chatId?: string
  groupId?: string
}

function formatBytes(bytes: number, decimals = 1) {
  if (bytes === 0) return "0 B"
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i]
}

const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024 // 50MB

export default function MessageInput({ onSend, disabled, replyingTo, onCancelReply, chatId, groupId }: Props) {
  const [text, setText] = useState("")
  const [slashIndex, setSlashIndex] = useState(0)
  const [helpVisible, setHelpVisible] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [attachment, setAttachment] = useState<{
    name: string
    url: string
    contentType: string
    size: number
  } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isTypingActiveRef = useRef(false)

  // Cleanup typing indicator when switching chats or unmounting
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
        typingTimeoutRef.current = null
      }
      if (isTypingActiveRef.current && chatId) {
        isTypingActiveRef.current = false
        socket.emit("typing_stop", { chatId, groupId })
      }
    }
  }, [chatId, groupId])

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextVal = e.target.value
    setText(nextVal)

    if (!chatId) return

    if (nextVal.trim().length > 0) {
      if (!isTypingActiveRef.current) {
        isTypingActiveRef.current = true
        socket.emit("typing_start", { chatId, groupId })
      }

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }

      typingTimeoutRef.current = setTimeout(() => {
        if (isTypingActiveRef.current) {
          isTypingActiveRef.current = false
          socket.emit("typing_stop", { chatId, groupId })
        }
        typingTimeoutRef.current = null
      }, 1500)
    } else {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
        typingTimeoutRef.current = null
      }
      if (isTypingActiveRef.current) {
        isTypingActiveRef.current = false
        socket.emit("typing_stop", { chatId, groupId })
      }
    }
  }

  // Derived slash command state
  const isSlashCommand = text.startsWith("/") && text.indexOf(" ") === -1
  const slashFilter = isSlashCommand ? text.slice(1) : ""
  const slashActive = isSlashCommand

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = "auto"
      el.style.height = Math.min(el.scrollHeight, 120) + "px"
    }
  }, [text])

  // Focus when replying
  useEffect(() => {
    if (replyingTo) textareaRef.current?.focus()
  }, [replyingTo])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > MAX_ATTACHMENT_SIZE) {
      setUploadError("File exceeds 50MB maximum allowed limit")
      e.target.value = ""
      return
    }

    setUploading(true)
    setUploadProgress(0)
    setUploadError(null)

    try {
      const res = await uploadFile({
        file,
        purpose: "attachment",
        chatId: chatId || undefined,
        onProgress: (pct) => setUploadProgress(pct),
      })

      const finalUrl = res.download_url || res.url
      if (!finalUrl) throw new Error("Upload did not return a valid download URL")

      setAttachment({
        name: res.file_name || file.name,
        url: finalUrl,
        contentType: res.content_type || file.type || "application/octet-stream",
        size: res.size_bytes || file.size,
      })
    } catch (err: unknown) {
      console.error("Attachment upload failed", err)
      setUploadError(err instanceof Error ? err.message : "Failed to upload file")
    } finally {
      setUploading(false)
      e.target.value = ""
    }
  }

  const handleSend = useCallback(
    (triggerAi: boolean) => {
      const trimmedText = text.trim()
      if (!trimmedText && !attachment) return
      if (triggerAi && disabled) return

      let messagePayload = trimmedText
      if (attachment) {
        const isImage =
          attachment.contentType.startsWith("image/") ||
          /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(attachment.name)
        const markdown = isImage
          ? `![${attachment.name}](${attachment.url})`
          : `[${attachment.name}](${attachment.url})`

        messagePayload = trimmedText ? `${trimmedText}\n\n${markdown}` : markdown
      }

      onSend(messagePayload, triggerAi)
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
        typingTimeoutRef.current = null
      }
      if (isTypingActiveRef.current && chatId) {
        isTypingActiveRef.current = false
        socket.emit("typing_stop", { chatId, groupId })
      }
      setText("")
      setAttachment(null)
      setUploadError(null)
      setHelpVisible(false)
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto"
      }
    },
    [text, attachment, disabled, onSend, chatId, groupId]
  )

  const handleSlashSelect = useCallback(
    (command: SlashCommand) => {
      if (command.action === "local") {
        setHelpVisible(true)
        setText("")
        return
      }

      if (command.template) {
        if (command.template.includes("{input}")) {
          setText((command.command.startsWith("/") ? command.command : "/" + command.command) + " ")
          textareaRef.current?.focus()
        } else {
          onSend(command.template, true)
          setText("")
        }
      }
    },
    [onSend]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (slashActive) {
        const filtered = getFilteredCommands(slashFilter)
        if (e.key === "ArrowDown") {
          e.preventDefault()
          setSlashIndex((prev) => Math.min(prev + 1, filtered.length - 1))
          return
        }
        if (e.key === "ArrowUp") {
          e.preventDefault()
          setSlashIndex((prev) => Math.max(prev - 1, 0))
          return
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault()
          if (filtered[slashIndex]) {
            handleSlashSelect(filtered[slashIndex])
          }
          return
        }
        if (e.key === "Escape") {
          e.preventDefault()
          setText("")
          return
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        if (text.startsWith("/")) {
          const parts = text.split(" ")
          const rawCmd = parts[0].toLowerCase()
          const cmdWithSlash = rawCmd.startsWith("/") ? rawCmd : "/" + rawCmd
          const cmdWithoutSlash = rawCmd.startsWith("/") ? rawCmd.slice(1) : rawCmd
          const userInput = parts.slice(1).join(" ").trim()
          const allCommands = getFilteredCommands("")
          const matched = allCommands.find(
            (c) => c.command.toLowerCase() === cmdWithSlash || c.command.toLowerCase() === cmdWithoutSlash
          )

          if (matched && matched.action === "ai" && matched.template && userInput) {
            const prompt = matched.template.replace("{input}", userInput)
            onSend(prompt, true)
            setText("")
            if (textareaRef.current) textareaRef.current.style.height = "auto"
            return
          }
        }
        handleSend(false)
      }
    },
    [slashActive, slashFilter, slashIndex, handleSlashSelect, text, handleSend, onSend]
  )

  return (
    <div className="shrink-0 border-t border-nexus-border bg-nexus-header/90 backdrop-blur-2xl p-3 md:p-4 z-20">
      {/* Help card */}
      {helpVisible && (
        <div className="mb-3 rounded-xl bg-nexus-card backdrop-blur-xl border border-nexus-border p-4 shadow-md animate-[slideDown_0.2s_ease-out]">
          <div className="flex items-center justify-between mb-2.5">
            <h4 className="text-xs font-bold text-nexus-text/90 uppercase tracking-wider">Available Commands</h4>
            <button
              type="button"
              onClick={() => setHelpVisible(false)}
              aria-label="Close help"
              className="p-1 hover:bg-nexus-hover rounded-full text-nexus-muted hover:text-nexus-text transition-colors"
            >
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {getFilteredCommands("").filter((c) => c.action === "ai").map((cmd) => (
              <div key={cmd.command} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg bg-nexus-surface/50">
                <span className="text-nexus-primary/70">{cmd.icon}</span>
                <div>
                  <span className="text-xs font-mono font-semibold text-nexus-text/80">
                    {cmd.command.startsWith("/") ? cmd.command : "/" + cmd.command}
                  </span>
                  <span className="text-[10px] text-nexus-muted/60 ml-1.5">{cmd.description}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reply preview */}
      {replyingTo && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-nexus-card border border-nexus-primary/20 p-2 pl-3 relative overflow-hidden shadow-sm animate-[slideDown_0.2s_ease-out]">
          <div className="w-0.5 absolute left-0 top-0 bottom-0 bg-nexus-primary/60 rounded-full" />
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold text-nexus-primary">
              Replying to {replyingTo.sender_name || replyingTo.sender}
            </span>
            <span className="text-[11px] text-nexus-muted truncate">{replyingTo.content}</span>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="ml-2 min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-nexus-hover rounded-full text-nexus-muted hover:text-nexus-text transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Upload error banner */}
      {uploadError && (
        <div className="mb-2 flex items-center justify-between text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl animate-[slideDown_0.2s_ease-out]">
          <span>{uploadError}</span>
          <button type="button" onClick={() => setUploadError(null)} className="p-0.5 hover:text-red-300">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Uploading progress pill */}
      {uploading && (
        <div className="mb-2 flex items-center gap-2 text-xs bg-nexus-card border border-nexus-border/60 px-3 py-2 rounded-xl shadow-sm animate-[slideDown_0.2s_ease-out]">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-nexus-primary" />
          <span className="text-nexus-muted">Uploading attachment...</span>
          <span className="font-semibold text-nexus-primary ml-auto">{uploadProgress}%</span>
        </div>
      )}

      {/* Uploaded attachment preview pill */}
      {attachment && !uploading && (
        <div className="mb-2 flex items-center justify-between gap-2 text-xs bg-nexus-card border border-nexus-primary/30 px-3 py-2 rounded-xl shadow-sm animate-[slideDown_0.2s_ease-out]">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-nexus-primary/10 text-nexus-primary flex items-center justify-center shrink-0 overflow-hidden">
              {attachment.contentType.startsWith("image/") ? (
                <img src={attachment.url} alt={attachment.name} className="w-full h-full object-cover" />
              ) : (
                <Paperclip className="w-3.5 h-3.5" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-nexus-text truncate max-w-[200px] sm:max-w-[320px]">
                {attachment.name}
              </p>
              <p className="text-[10px] text-nexus-muted">
                {formatBytes(attachment.size)} · Ready to send
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAttachment(null)}
            className="p-1.5 hover:bg-nexus-hover rounded-lg text-nexus-muted hover:text-nexus-text transition-colors"
            aria-label="Remove attachment"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="relative flex items-end gap-2">
        {/* Slash command menu */}
        <SlashCommandMenu
          filter={slashFilter}
          activeIndex={slashIndex}
          onSelect={handleSlashSelect}
          onClose={() => setText("")}
          visible={slashActive}
        />

        {/* Paperclip attachment button */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.tar,.gz,audio/*,video/*"
          onChange={handleFileSelect}
          disabled={disabled || uploading}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading}
          aria-label="Attach file"
          className="
            min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-nexus-border
            bg-nexus-card text-nexus-muted hover:text-nexus-text hover:bg-nexus-hover
            active:scale-95 transition-all duration-150
            disabled:opacity-40 disabled:cursor-not-allowed
          "
          title="Attach file (max 50MB)"
        >
          {uploading ? (
            <Loader2 className="w-4 h-4 animate-spin text-nexus-primary" />
          ) : (
            <Paperclip className="w-4 h-4" />
          )}
        </button>

        <textarea
          ref={textareaRef}
          value={text}
          rows={1}
          aria-label="Type a message"
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (/ for commands)"
          className="
            flex-1 resize-none rounded-xl px-4 py-2.5 text-sm
            bg-nexus-card text-nexus-text
            placeholder:text-nexus-muted/60
            outline-none border border-nexus-border
            focus:border-nexus-primary/50 focus:ring-[3px] focus:ring-nexus-primary/10
            shadow-sm
            transition-all duration-200
            leading-5
          "
        />

        {/* AI Button */}
        <button
          type="button"
          onClick={() => handleSend(true)}
          disabled={disabled || (!text.trim() && !attachment)}
          aria-label="Ask AI assistant"
          className="
            flex items-center justify-center gap-1.5 rounded-xl border border-nexus-primary/25
            bg-nexus-primary/8 min-h-[44px] px-3 py-2.5
            text-xs font-medium text-nexus-primary/80
            hover:bg-nexus-primary/15 hover:border-nexus-primary/40
            active:scale-95 transition-all duration-150
            disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100
          "
          title="Ask AI"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">AI</span>
        </button>

        {/* Send Button */}
        <button
          type="button"
          onClick={() => handleSend(false)}
          disabled={(!text.trim() && !attachment) || uploading}
          aria-label="Send message"
          className="
            rounded-xl bg-nexus-primary min-h-[44px] min-w-[44px] flex items-center justify-center px-3.5 py-2.5
            text-white shadow-md shadow-nexus-primary/15
            hover:shadow-lg hover:shadow-nexus-primary/25 hover:brightness-110
            active:scale-[0.95] active:duration-100
            transition-all duration-200
            disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100
            disabled:shadow-none
          "
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
