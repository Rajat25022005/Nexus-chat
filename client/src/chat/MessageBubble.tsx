import logo from '../assets/logo.svg'
import ReactMarkdown from 'react-markdown'
import { getImageUrl } from '../api/config'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { useState } from 'react'
import { motion, useAnimation, type PanInfo } from 'framer-motion'
import { Reply } from 'lucide-react'

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

const Avatar = ({ name, image }: { name?: string, image?: string, isMe?: boolean }) => {
  return (
    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-700 overflow-hidden flex items-center justify-center shadow-sm border border-white/10 mt-1 select-none">
      {image ? (
        <img src={image} alt={name} className="w-full h-full object-cover" />
      ) : (
        <div className="text-xs text-gray-300 font-bold uppercase">
          {(name || "?")[0]}
        </div>
      )}
    </div>
  )
}

type Props = {
  message: Message
  currentUserId: string
  currentUserImage?: string | null
  onReply?: (message: Message) => void
  onDelete: (messageId: string, type: "everyone" | "me") => void
  onEdit?: (messageId: string, content: string) => void
}

export default function MessageBubble({ message, currentUserId, currentUserImage, onReply, onDelete, onEdit }: Props) {
  const isMe = message.role === "user" && message.sender === currentUserId
  const isOtherUser = message.role === "user" && !isMe

  const [showDeleteMenu, setShowDeleteMenu] = useState(false)
  const [showDeleteOptions, setShowDeleteOptions] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)

  const handleSaveEdit = () => {
    if (onEdit && editContent.trim() !== message.content) {
      onEdit(message.id, editContent)
    }
    setIsEditing(false)
  }

  const alignClass = isMe ? "justify-end" : "justify-start"

  const bubbleContentClass = isMe
    ? "bg-[#005c4b] text-[#e9edef] rounded-lg rounded-tr-none px-3 py-1.5 shadow-sm max-w-[85%] relative group"
    : isOtherUser
      ? "bg-[#202c33] text-[#e9edef] rounded-lg rounded-tl-none px-3 py-1.5 shadow-sm max-w-[85%] relative group"
      : "bg-[#102420] text-[#e9edef] rounded-lg rounded-tl-none p-0 shadow-sm max-w-[85%] relative group"

  // Swipe logic
  const controls = useAnimation()

  const handleDragEnd = async (_: any, info: PanInfo) => {
    const offset = info.offset.x;
    if (offset > 50) { // Swipe Right to Reply (or Swipe Left based on pref, usually right on WhatsApp) based on logic. Let's assume standard behavior.
      // Wait, standard behavior: Swipe Bubble LEFT (content moves left) or Swipe RIGHT?
      // WhatsApp iOS: Swipe Right (bubble moves right) reveals arrow on left.
      // Let's implement Drag with constraint.
      if (onReply) onReply(message)
    }
    await controls.start({ x: 0 })
  }

  const scrollToMessage = (id: string) => {
    // Logic handled via href anchor or custom scroll would be better, but let's try basic ID scroll
    document.getElementById("msg_" + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  if (message.is_deleted) {
    return (
      <div className={`flex w-full ${isMe ? "justify-end" : "justify-start"} mb-4 px-4`}>
        <div className="rounded-2xl px-4 py-2 bg-nexus-card border border-nexus-border/50 text-nexus-muted text-sm italic">
          <span className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
            This message was deleted
          </span>
        </div>
      </div>
    )
  }

  return (
    <motion.div
      className={`group relative flex w-full mb-2 ${isMe ? "items-end" : "items-start"}`}
      id={"msg_" + message.id}
    >
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0, right: 0.5 }} // Only allow drag right
        onDragEnd={handleDragEnd}
        animate={controls}
        className={`flex w-full ${alignClass} gap-2 px-2`}
      >
        {!isMe && <Avatar name={message.sender_name || "AI"} image={message.role === "assistant" ? logo : getImageUrl(message.sender_image)} />}

        <div className={bubbleContentClass}>
          {/* Menu Button (3-dots) */}
          <div className={`absolute top-1 ${isMe ? "left-[-25px]" : "right-[-25px]"} h-full flex flex-col pt-1 opacity-0 group-hover:opacity-100 transition-opacity hidden md:flex`}>
            <button
              onClick={() => setShowDeleteMenu(!showDeleteMenu)}
              className="p-1 text-gray-400 hover:text-white bg-black/20 rounded-full"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg>
            </button>

            {showDeleteMenu && (
              <div className="absolute top-8 z-20 w-32 rounded-lg border border-nexus-border bg-nexus-card shadow-xl p-1 flex flex-col gap-1 overflow-hidden" style={{ [isMe ? "right" : "left"]: 0 }}>
                {!showDeleteOptions ? (
                  <>
                    <button
                      onClick={() => { onReply && onReply(message); setShowDeleteMenu(false) }}
                      className="w-full text-left px-3 py-2 text-sm text-nexus-text hover:bg-white/5 rounded transition-colors flex items-center gap-2"
                    >
                      <Reply size={14} /> Reply
                    </button>

                    {isMe && (
                      <button
                        onClick={() => { setIsEditing(true); setShowDeleteMenu(false) }}
                        className="w-full text-left px-3 py-2 text-sm text-nexus-text hover:bg-white/5 rounded transition-colors flex items-center gap-2"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
                        Edit
                      </button>
                    )}

                    <button
                      onClick={() => setShowDeleteOptions(true)}
                      className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded transition-colors flex items-center gap-2"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                      Delete
                    </button>
                  </>
                ) : (
                  <>
                    <div className="px-2 py-1 text-xs text-nexus-muted uppercase font-bold tracking-wider">Delete Message?</div>
                    <button
                      onClick={() => { onDelete(message.id, "me"); setShowDeleteMenu(false); setShowDeleteOptions(false); }}
                      className="w-full text-left px-3 py-2 text-sm text-nexus-text hover:bg-white/5 rounded transition-colors flex items-center gap-2"
                    >
                      For Me
                    </button>

                    {isMe && (
                      <button
                        onClick={() => { onDelete(message.id, "everyone"); setShowDeleteMenu(false); setShowDeleteOptions(false); }}
                        className="w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 rounded transition-colors flex items-center gap-2"
                      >
                        For Everyone
                      </button>
                    )}
                    <div className="h-px bg-nexus-border my-1" />
                    <button
                      onClick={() => setShowDeleteOptions(false)}
                      className="w-full text-left px-3 py-2 text-xs text-nexus-muted hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          {/* User (Me or Other) */}
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed relative pb-1 min-w-[60px]">
            {isEditing ? (
              <div className="flex flex-col gap-2 min-w-[200px]">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="bg-black/20 text-white rounded p-1 text-sm w-full outline-none border border-white/10 resize-none h-auto min-h-[60px]"
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setIsEditing(false)} className="text-xs text-nexus-muted hover:text-white">Cancel</button>
                  <button onClick={handleSaveEdit} className="text-xs bg-[#06cf9c] text-black px-2 py-1 rounded font-bold hover:brightness-110">Save</button>
                </div>
              </div>
            ) : (
              message.content
            )}
            {/* Time or Status could go here */}
          </div>
        </div>

        {/* For ME: Use sender_image from message if available */}
        {isMe && (
          <Avatar
            name="Me"
            image={getImageUrl(message.sender_image || currentUserImage)}
            isMe
          />
        )}
      </motion.div>
    </motion.div>
  )
}