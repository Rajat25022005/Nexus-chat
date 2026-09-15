import { memo, useState, useMemo, useCallback, useRef, useEffect } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter"
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism"
import js from "react-syntax-highlighter/dist/esm/languages/prism/javascript"
import ts from "react-syntax-highlighter/dist/esm/languages/prism/typescript"
import py from "react-syntax-highlighter/dist/esm/languages/prism/python"
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash"
import json from "react-syntax-highlighter/dist/esm/languages/prism/json"
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql"
import css from "react-syntax-highlighter/dist/esm/languages/prism/css"
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup"
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx"
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx"

SyntaxHighlighter.registerLanguage("javascript", js)
SyntaxHighlighter.registerLanguage("js", js)
SyntaxHighlighter.registerLanguage("typescript", ts)
SyntaxHighlighter.registerLanguage("ts", ts)
SyntaxHighlighter.registerLanguage("python", py)
SyntaxHighlighter.registerLanguage("py", py)
SyntaxHighlighter.registerLanguage("bash", bash)
SyntaxHighlighter.registerLanguage("sh", bash)
SyntaxHighlighter.registerLanguage("json", json)
SyntaxHighlighter.registerLanguage("sql", sql)
SyntaxHighlighter.registerLanguage("css", css)
SyntaxHighlighter.registerLanguage("markup", markup)
SyntaxHighlighter.registerLanguage("html", markup)
SyntaxHighlighter.registerLanguage("xml", markup)
SyntaxHighlighter.registerLanguage("tsx", tsx)
SyntaxHighlighter.registerLanguage("jsx", jsx)
import { createPortal } from "react-dom"
import { getImageUrl } from "../api/config"
import { sanitizeUrl } from "../lib/fileSecurity"
import { downloadFile } from "../api/files"
import { Reply, Pencil, Trash2, Check, X, MessageCircle, FileText, Download } from "lucide-react"
import { QuickReactionPicker, ReactionBar } from "./ReactionBar"
import type { Message, FileAttachment } from "../types"

interface ParsedAttachment {
  name: string
  url: string
  isImage: boolean
  fileId?: string
}

function extractFileIdFromUrl(url: string): string | undefined {
  if (!url) return undefined
  const filesMatch = url.match(/\/files\/([0-9a-fA-F-]{36})/i)
  if (filesMatch) return filesMatch[1]

  const attachmentMatch = url.match(/\/attachments\/[0-9a-fA-F-]{36}\/([0-9a-fA-F-]{36})/i)
  if (attachmentMatch) return attachmentMatch[1]

  const uuidMatches = url.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g)
  if (uuidMatches && uuidMatches.length > 0) {
    return uuidMatches[uuidMatches.length - 1]
  }
  return undefined
}

function parseMessageAttachments(
  content: string,
  explicitAttachments?: FileAttachment[]
): { text: string; attachments: ParsedAttachment[] } {
  const attachments: ParsedAttachment[] = []
  let remainingText = content || ""

  // 1. Explicit attachments from message object
  if (explicitAttachments && explicitAttachments.length > 0) {
    explicitAttachments.forEach((att) => {
      const isImg =
        (att.contentType?.startsWith("image/") ?? false) ||
        /\.(png|jpe?g|gif|webp|bmp)$/i.test(att.name || att.url)
      const downloadUrl = att.download_url || att.url
      attachments.push({
        name: att.name || "Attachment",
        url: downloadUrl,
        isImage: isImg,
        fileId: att.id || extractFileIdFromUrl(downloadUrl),
      })
    })
  }

  // 2. Extract Markdown images: ![alt](url)
  const imgRegex = /!\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g
  let imgMatch: RegExpExecArray | null
  while ((imgMatch = imgRegex.exec(content || "")) !== null) {
    const name = imgMatch[1] || "Image"
    const url = imgMatch[2]
    if (!attachments.some((a) => a.url === url)) {
      attachments.push({
        name,
        url,
        isImage: true,
        fileId: extractFileIdFromUrl(url),
      })
    }
    remainingText = remainingText.replace(imgMatch[0], "")
  }

  // 3. Extract Markdown links: [name](url)
  const linkRegex = /\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g
  let linkMatch: RegExpExecArray | null
  while ((linkMatch = linkRegex.exec(content || "")) !== null) {
    const name = linkMatch[1] || "Document"
    const url = linkMatch[2]
    if (!attachments.some((a) => a.url === url)) {
      const isImg =
        /\.(png|jpe?g|gif|webp|bmp)$/i.test(name) ||
        /\.(png|jpe?g|gif|webp|bmp)(\?.*)?$/i.test(url)
      attachments.push({
        name,
        url,
        isImage: isImg,
        fileId: extractFileIdFromUrl(url),
      })
    }
    remainingText = remainingText.replace(linkMatch[0], "")
  }

  return { text: remainingText.trim(), attachments }
}

const COLORS = [
  "#e542a3", "#02a698", "#e91e63", "#9c27b0", "#673ab7", "#3f51b5",
  "#2196f3", "#00bcd4", "#009688", "#4caf50", "#8bc34a", "#cddc39",
  "#ffeb3b", "#ffc107", "#ff9800", "#ff5722", "#795548", "#607d8b",
]

function getSenderColor(sender?: string) {
  if (!sender) return "#34b7f1"
  let hash = 0
  for (let i = 0; i < sender.length; i++) {
    hash = sender.charCodeAt(i) + ((hash << 5) - hash)
  }
  return COLORS[Math.abs(hash % COLORS.length)]
}

function getRelativeTime(dateStr?: string): string {
  if (!dateStr) return ""
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = Math.floor((now - then) / 1000)
  if (diff < 60) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const CodeBlockHeader = memo(function CodeBlockHeader({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  return (
    <div className="bg-nexus-surface/90 px-4 py-1.5 text-[11px] text-nexus-muted border-b border-nexus-border/40 flex justify-between items-center select-none rounded-t-lg">
      <span className="lowercase font-mono">{language}</span>
      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy code to clipboard"
        className="hover:text-nexus-text transition-colors px-2 py-0.5 rounded hover:bg-nexus-hover"
      >
        {copied ? <span className="text-emerald-500 font-medium">Copied</span> : "Copy"}
      </button>
    </div>
  )
})

type Props = {
  message: Message
  currentUserId: string
  currentUserImage?: string | null
  isStreaming?: boolean
  onReply?: (message: Message) => void
  onDelete: (messageId: string, type: "everyone" | "me") => void
  onEdit?: (messageId: string, content: string) => void
  onReact?: (emoji: string) => void
  onOpenThread?: () => void
}

const MessageBubble = memo(function MessageBubble({
  message,
  currentUserId,
  onReply,
  onDelete,
  onEdit,
  onReact,
  onOpenThread,
  isStreaming = false,
}: Props) {
  const isMe = message.role === "user" && message.sender === currentUserId
  const isOtherUser = message.role === "user" && !isMe
  const isAI = message.role === "assistant"

  const [showMenu, setShowMenu] = useState(false)
  const [showDeleteOptions, setShowDeleteOptions] = useState(false)
  const [showReactionPicker, setShowReactionPicker] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)
  const [entranceDone, setEntranceDone] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [refreshedUrls, setRefreshedUrls] = useState<Record<string, string>>({})
  const bubbleRef = useRef<HTMLDivElement>(null)
  const lightboxRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // Lightbox accessibility: Escape key, focus trapping, scroll locking, focus restore
  useEffect(() => {
    if (!lightboxUrl) return

    previousFocusRef.current = document.activeElement as HTMLElement | null

    const closeBtn = lightboxRef.current?.querySelector<HTMLButtonElement>("button")
    closeBtn?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setLightboxUrl(null)
        return
      }

      if (e.key === "Tab" && lightboxRef.current) {
        const focusableElements = lightboxRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (focusableElements.length === 0) return
        const first = focusableElements[0]
        const last = focusableElements[focusableElements.length - 1]

        if (e.shiftKey) {
          if (document.activeElement === first || document.activeElement === lightboxRef.current) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = originalOverflow
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === "function") {
        previousFocusRef.current.focus()
      }
    }
  }, [lightboxUrl])

  const { text: cleanText, attachments } = useMemo(
    () => parseMessageAttachments(message.content, message.attachments),
    [message.content, message.attachments]
  )

  const getEffectiveUrl = useCallback(
    (att: ParsedAttachment) => refreshedUrls[att.url] || att.url,
    [refreshedUrls]
  )

  const handleImageError = useCallback(
    async (att: ParsedAttachment) => {
      const fileId = att.fileId || extractFileIdFromUrl(att.url)
      if (!fileId || refreshedUrls[att.url]) return
      try {
        const res = await downloadFile(fileId)
        if (res.download_url) {
          setRefreshedUrls((prev) => ({ ...prev, [att.url]: res.download_url }))
        }
      } catch (err) {
        console.warn("Failed to refresh expired image attachment URL", err)
      }
    },
    [refreshedUrls]
  )

  const handleDownloadAttachment = useCallback(
    async (e: React.MouseEvent, att: ParsedAttachment) => {
      e.preventDefault()
      let downloadUrl = refreshedUrls[att.url] || att.url
      const fileId = att.fileId || extractFileIdFromUrl(att.url)

      if (fileId) {
        try {
          const res = await downloadFile(fileId)
          if (res.download_url) {
            downloadUrl = res.download_url
            setRefreshedUrls((prev) => ({ ...prev, [att.url]: res.download_url }))
          }
        } catch (err) {
          console.warn("Failed to refresh pre-signed download URL, using original URL", err)
        }
      }

      const anchor = document.createElement("a")
      anchor.href = downloadUrl
      anchor.download = att.name
      anchor.target = "_blank"
      anchor.rel = "noopener noreferrer"
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
    },
    [refreshedUrls]
  )

  const senderColor = useMemo(() => getSenderColor(message.sender), [message.sender])

  // Entrance animation
  useEffect(() => {
    if (entranceDone || !bubbleRef.current) return
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (prefersReduced) {
      setEntranceDone(true)
      return
    }
    // Use CSS animation for entrance
    bubbleRef.current.style.animation = "msgEnter 0.25s ease-out forwards"
    const timer = setTimeout(() => setEntranceDone(true), 250)
    return () => clearTimeout(timer)
  }, [entranceDone])

  const handleSaveEdit = useCallback(() => {
    if (onEdit && editContent.trim() !== message.content) {
      onEdit(message.id, editContent)
    }
    setIsEditing(false)
  }, [onEdit, editContent, message.content, message.id])

  const handleReact = useCallback((emoji: string) => {
    onReact?.(emoji)
    setShowReactionPicker(false)
  }, [onReact])

  if (message.is_deleted) {
    return (
      <div className={`flex w-full ${isMe ? "justify-end" : "justify-start"} mb-2 px-1`}>
        <div className="rounded-2xl px-4 py-2 bg-nexus-card/40 border border-nexus-border/20 text-nexus-muted/50 text-xs italic">
          <span className="flex items-center gap-1.5">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
            This message was deleted
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={bubbleRef}
      className={`group relative flex w-full mb-1 px-1 ${isMe ? "justify-end" : "justify-start"}`}
      id={"msg_" + message.id}
      style={{ opacity: entranceDone ? 1 : 0, transform: entranceDone ? "none" : "translateY(10px)" }}
    >
      <div className={`flex max-w-[88%] md:max-w-[75%] gap-2 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
        {/* Avatar */}
        {!isMe && (
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-nexus-surface overflow-hidden flex items-center justify-center border border-white/[0.04] mt-0.5 self-end">
            {message.sender_image ? (
              <img src={getImageUrl(message.sender_image)} alt={message.sender_name || message.sender || "User"} className="w-full h-full object-cover" loading="lazy" />
            ) : (
              <span className="text-[10px] text-nexus-muted/70 font-bold uppercase">
                {(message.sender_name || message.sender || "?")[0]}
              </span>
            )}
          </div>
        )}

        {/* Bubble + Reactions column */}
        <div className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
          {/* Bubble */}
          <div
            className={`
              relative px-3.5 py-2 rounded-2xl shadow-sm
              ${isMe
                ? "bg-nexus-primary/90 text-white rounded-br-sm"
                : isAI
                ? `bg-gradient-to-br from-nexus-surface to-nexus-card/80 text-nexus-text rounded-bl-sm border ${isStreaming ? "border-nexus-primary/30" : "border-nexus-primary/10"}`
                : "bg-nexus-surface text-nexus-text rounded-bl-sm border border-nexus-border/40"
              }
              ${isStreaming ? "streaming-bubble" : ""}
            `}
          >
            {/* Context menu + reaction picker */}
            <div className={`
              absolute top-0.5 ${isMe ? "left-0 -translate-x-full pr-1" : "right-0 translate-x-full pl-1"}
              flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 transition-opacity duration-150
            `}>
              {/* Quick reaction trigger */}
              <div className="relative">
                <button
                  type="button"
                  aria-label="Add reaction"
                  onClick={() => { setShowReactionPicker(!showReactionPicker); setShowMenu(false) }}
                  className="p-1 text-nexus-muted/60 hover:text-nexus-text hover:bg-nexus-surface rounded-md transition-colors text-sm"
                >
                  😊
                </button>
                <QuickReactionPicker
                  visible={showReactionPicker}
                  onSelect={handleReact}
                />
              </div>

              <button
                type="button"
                aria-label="Message options"
                onClick={() => { setShowMenu(!showMenu); setShowDeleteOptions(false); setShowReactionPicker(false) }}
                className="p-1 text-nexus-muted/60 hover:text-nexus-text hover:bg-nexus-surface rounded-md transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
                </svg>
              </button>

              {showMenu && (
                <div className="absolute top-14 z-20 w-36 rounded-xl border border-nexus-border/50 bg-nexus-card/95 backdrop-blur-xl shadow-xl py-1 overflow-hidden"
                  style={{ [isMe ? "right" : "left"]: 0 }}
                >
                  {!showDeleteOptions ? (
                    <>
                      <button
                        onClick={() => { onReply?.(message); setShowMenu(false) }}
                        className="w-full text-left px-3 py-1.5 text-xs text-nexus-text/80 hover:bg-nexus-hover transition-colors flex items-center gap-2"
                      >
                        <Reply size={12} /> Reply
                      </button>
                      <button
                        onClick={() => { onOpenThread?.(); setShowMenu(false) }}
                        className="w-full text-left px-3 py-1.5 text-xs text-nexus-text/80 hover:bg-nexus-hover transition-colors flex items-center gap-2"
                      >
                        <MessageCircle size={12} /> Reply in thread
                      </button>
                      {isMe && (
                        <button
                          onClick={() => { setIsEditing(true); setShowMenu(false) }}
                          className="w-full text-left px-3 py-1.5 text-xs text-nexus-text/80 hover:bg-nexus-hover transition-colors flex items-center gap-2"
                        >
                          <Pencil size={12} /> Edit
                        </button>
                      )}
                      <div className="h-px bg-nexus-border/30 my-0.5" />
                      <button
                        onClick={() => setShowDeleteOptions(true)}
                        className="w-full text-left px-3 py-1.5 text-xs text-red-400/80 hover:bg-red-500/10 transition-colors flex items-center gap-2"
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="px-3 py-1 text-[9px] text-nexus-muted uppercase font-bold tracking-wider">Delete?</div>
                      <button
                        onClick={() => { onDelete(message.id, "me"); setShowMenu(false); setShowDeleteOptions(false) }}
                        className="w-full text-left px-3 py-1.5 text-xs text-nexus-text/80 hover:bg-nexus-hover transition-colors"
                      >
                        For Me
                      </button>
                      {isMe && (
                        <button
                          onClick={() => { onDelete(message.id, "everyone"); setShowMenu(false); setShowDeleteOptions(false) }}
                          className="w-full text-left px-3 py-1.5 text-xs text-red-400/80 hover:bg-red-500/10 transition-colors"
                        >
                          For Everyone
                        </button>
                      )}
                      <div className="h-px bg-nexus-border/30 my-0.5" />
                      <button
                        onClick={() => setShowDeleteOptions(false)}
                        className="w-full text-left px-3 py-1 text-[10px] text-nexus-muted hover:text-nexus-text transition-colors"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Sender name */}
            {isOtherUser && message.sender_name && (
              <p className="text-[11px] font-semibold mb-0.5" style={{ color: senderColor }}>
                {message.sender_name}
              </p>
            )}

            {/* Reply reference */}
            {message.replyTo && (
              <div
                className="mb-1.5 pl-2 border-l-2 border-nexus-primary/40 bg-black/10 rounded-r-md py-1 pr-2 cursor-pointer hover:bg-black/15 transition-colors"
                onClick={() => document.getElementById("msg_" + message.replyTo?.id)?.scrollIntoView({ behavior: "smooth", block: "center" })}
              >
                <p className="text-[10px] font-semibold text-nexus-primary/80">{message.replyTo.sender}</p>
                <p className="text-[11px] text-nexus-muted truncate">{message.replyTo.content}</p>
              </div>
            )}

            {/* Content */}
            <div className="text-[14px] leading-relaxed whitespace-pre-wrap">
              {isEditing ? (
                <div className="flex flex-col gap-2 min-w-[200px]">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="bg-nexus-card text-nexus-text rounded-lg p-2 text-sm w-full outline-none border border-nexus-border/60 resize-none min-h-[60px] focus:border-nexus-primary/50"
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setIsEditing(false)} className="text-[11px] text-nexus-muted hover:text-nexus-text px-2 py-1 rounded transition-colors flex items-center gap-1">
                      <X size={10} /> Cancel
                    </button>
                    <button onClick={handleSaveEdit} className="text-[11px] bg-emerald-600 text-white px-3 py-1 rounded-md font-medium hover:bg-emerald-500 transition-colors flex items-center gap-1">
                      <Check size={10} /> Save
                    </button>
                  </div>
                </div>
              ) : isAI ? (
                <div className="prose dark:prose-invert prose-sm max-w-none text-nexus-text [&_pre]:m-0 [&_pre]:bg-transparent [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_ul]:mb-1.5 [&_ol]:mb-1.5 [&_li]:mb-0.5 [&_code]:text-emerald-600 dark:[&_code]:text-emerald-300 [&_code]:bg-nexus-surface [&_code]:px-1 [&_code]:rounded [&_code]:text-[13px]">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    urlTransform={(url) => sanitizeUrl(url)}
                    components={{
                      a({ href, children, ...props }) {
                        const safeHref = sanitizeUrl(href)
                        if (!safeHref || safeHref === "#") {
                          return <span>{children}</span>
                        }
                        return (
                          <a
                            href={safeHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-nexus-primary underline underline-offset-2 hover:brightness-110 transition-colors"
                            {...props}
                          >
                            {children}
                          </a>
                        )
                      },
                      img({ src, alt, ...props }) {
                        const safeSrc = sanitizeUrl(src)
                        // Block empty, protocol-less, SVG, or HTML image sources to prevent DOM XSS
                        if (
                          !safeSrc ||
                          safeSrc.toLowerCase().endsWith(".svg") ||
                          safeSrc.toLowerCase().includes("image/svg+xml")
                        ) {
                          return (
                            <span className="text-xs text-nexus-muted italic block my-1">
                              [Image blocked: vector SVG images are not permitted]
                            </span>
                          )
                        }
                        return (
                          <img
                            src={safeSrc}
                            alt={alt || "Embedded image"}
                            loading="lazy"
                            decoding="async"
                            referrerPolicy="no-referrer"
                            onClick={() => setLightboxUrl(safeSrc)}
                            className="max-w-full max-h-64 object-contain rounded-lg my-1.5 border border-white/[0.06] cursor-pointer hover:opacity-95 transition-opacity"
                            {...props}
                          />
                        )
                      },
                      code({ className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || "")
                        const codeString = String(children).replace(/\n$/, "")
                        return match ? (
                          <div className="rounded-lg overflow-hidden my-2 border border-white/[0.06]">
                            <CodeBlockHeader language={match[1]} code={codeString} />
                            <SyntaxHighlighter
                              style={vscDarkPlus}
                              language={match[1]}
                              PreTag="div"
                              customStyle={{ margin: 0, borderRadius: 0, fontSize: "12px", padding: "12px 16px" }}
                            >
                              {codeString}
                            </SyntaxHighlighter>
                          </div>
                        ) : (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        )
                      },
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                  {/* Streaming cursor */}
                  {isStreaming && (
                    <span className="streaming-cursor" aria-hidden="true">▍</span>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {cleanText && <div>{cleanText}</div>}
                  {attachments.length > 0 && (
                    <div className="flex flex-col gap-1.5 mt-1">
                      {attachments.map((att, idx) => {
                        const effectiveUrl = getEffectiveUrl(att)
                        return att.isImage ? (
                          <div
                            key={idx}
                            className="overflow-hidden rounded-xl border border-white/10 bg-black/20 max-w-sm cursor-pointer hover:opacity-95 transition-opacity"
                            onClick={() => setLightboxUrl(effectiveUrl)}
                          >
                            <img
                              src={effectiveUrl}
                              alt={att.name}
                              loading="lazy"
                              onError={() => handleImageError(att)}
                              className="max-h-60 w-auto object-contain rounded-xl"
                            />
                          </div>
                        ) : (
                          <a
                            key={idx}
                            href={effectiveUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            download={att.name}
                            onClick={(e) => handleDownloadAttachment(e, att)}
                            className={`flex items-center gap-2.5 p-2 rounded-xl transition-all no-underline ${
                              isMe
                                ? "bg-black/20 hover:bg-black/30 text-white border border-white/10"
                                : "bg-nexus-card hover:bg-nexus-hover text-nexus-text border border-nexus-border/50"
                            }`}
                          >
                            <div className="w-8 h-8 rounded-lg bg-nexus-primary/10 text-nexus-primary flex items-center justify-center shrink-0">
                              <FileText className="w-4 h-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium truncate">
                                {att.name}
                              </p>
                              <span className="text-[10px] opacity-70">
                                Download file
                              </span>
                            </div>
                            <div className="p-1 rounded-md opacity-70 hover:opacity-100 transition-opacity">
                              <Download className="w-3.5 h-3.5" />
                            </div>
                          </a>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Edited indicator */}
            {message.is_edited && (
              <span className="text-[9px] text-nexus-muted/40 italic mt-0.5 block">edited</span>
            )}
          </div>

          {/* Reaction badges */}
          {message.reactions && Object.keys(message.reactions).length > 0 && (
            <ReactionBar
              reactions={message.reactions}
              currentUserEmail={currentUserId}
              onReact={handleReact}
              isMe={isMe}
            />
          )}

          {/* Thread indicator */}
          {(message.thread_count || 0) > 0 && (
            <button
              type="button"
              onClick={onOpenThread}
              className={`flex items-center gap-1.5 mt-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all duration-150 hover:bg-nexus-primary/10 ${
                isMe ? "text-white/70 hover:text-white" : "text-nexus-primary/70 hover:text-nexus-primary"
              }`}
              aria-label={`${message.thread_count} thread replies`}
            >
              <MessageCircle className="w-3 h-3" />
              <span>{message.thread_count} {message.thread_count === 1 ? "reply" : "replies"}</span>
              {message.thread_last_reply_at && (
                <span className="text-nexus-muted/50">· {getRelativeTime(message.thread_last_reply_at)}</span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightboxUrl &&
        createPortal(
          <div
            ref={lightboxRef}
            role="dialog"
            aria-modal="true"
            aria-label="Image preview"
            tabIndex={-1}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-[fadeIn_0.15s_ease-out]"
            onClick={() => setLightboxUrl(null)}
          >
            <button
              type="button"
              onClick={() => setLightboxUrl(null)}
              className="absolute top-4 right-4 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors z-10"
              aria-label="Close image preview"
            >
              <X size={20} />
            </button>
            <img
              src={lightboxUrl}
              alt="Preview"
              className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl animate-[scaleIn_0.15s_ease-out]"
              onClick={(e) => e.stopPropagation()}
            />
          </div>,
          document.body
        )}
    </div>
  )
})

export default MessageBubble
