import { useState, useCallback, useEffect } from "react"
import Sidebar from "./Sidebar"
import ChatHeader from "./ChatHeader"
import MessageList from "./MessageList"
import MessageInput from "./MessageInput"
import ThreadPanel from "./ThreadPanel"
import { useWorkspace } from "../context/WorkspaceContext"
import { useCommandPaletteStore } from "../stores/commandPaletteStore"
import { ErrorBoundary } from "../components/ErrorBoundary"
import GroupDetailsModal from "../components/GroupDetailsModal"
import UserSearchModal from "../components/UserSearchModal"
import type { Message } from "../types"

export default function ChatLayout() {

  const [isSidebarOpen, setIsSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth > 768 : true
  )
  const [isInfoOpen, setIsInfoOpen] = useState(false)
  const [showGroupDetails, setShowGroupDetails] = useState(false)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [isUserSearchOpen, setIsUserSearchOpen] = useState(false)
  const [activeThread, setActiveThread] = useState<Message | null>(null)

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setIsSidebarOpen(false)
        setIsInfoOpen(false)
      }
    }
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  // Lock body scroll when mobile thread drawer is open
  useEffect(() => {
    if (activeThread && window.innerWidth < 768) {
      const original = document.body.style.overflow
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = original
      }
    }
  }, [activeThread])

  const handleMobileAction = useCallback(() => {
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false)
    }
  }, [])

  const {
    groups,
    directChats,
    activeChat,
    activeGroup,
    activeGroupId,
    activeChatId,
    setActiveGroupId,
    setActiveChatId,
    createOrOpenDirectChat,
    selectDirectChat,
    deleteDirectChat,
    isTyping,
    isLoading,
    streamingMessageId,
    sendMessage,
    createGroup,
    createChat,
    joinGroup,
    userEmail,
    deleteGroup,
    deleteChat,
    leaveGroup,
    removeMember,
    profileImage,
    deleteMessage,
    editMessage,
    reactToMessage,
    sendThreadReply,
    loadThreadMessages,
    typingUser,
    onlineUserIds,
  } = useWorkspace()

  const [isThreadLoading, setIsThreadLoading] = useState(false)

  const handleReply = useCallback((message: Message) => {
    setReplyingTo(message)
  }, [])

  const cancelReply = useCallback(() => {
    setReplyingTo(null)
  }, [])

  const handleSend = useCallback(
    (text: string, triggerAi?: boolean) => {
      sendMessage(
        text,
        triggerAi ?? false,
        replyingTo
          ? {
              id: replyingTo.id,
              sender: replyingTo.sender_name || replyingTo.sender || "",
              content: replyingTo.content,
            }
          : undefined
      )
      setReplyingTo(null)
    },
    [sendMessage, replyingTo]
  )

  const handleReact = useCallback(
    (messageId: string, emoji: string) => {
      reactToMessage(messageId, emoji)
    },
    [reactToMessage]
  )

  const handleOpenThread = useCallback(
    (message: Message) => {
      setActiveThread(message)
      setIsInfoOpen(false) // threads replace info panel
      setIsThreadLoading(true)
      loadThreadMessages(message.id).finally(() => {
        setIsThreadLoading(false)
      })
    },
    [loadThreadMessages]
  )

  const handleCloseThread = useCallback(() => {
    setActiveThread(null)
  }, [])

  const handleThreadReply = useCallback(
    (content: string) => {
      if (activeThread) {
        sendThreadReply(activeThread.id, content)
      }
    },
    [activeThread, sendThreadReply]
  )

  // Keep activeThread in sync with message updates (reactions, thread_messages, etc.)
  const activeThreadMessage = activeThread
    ? activeChat.messages.find((m) => m.id === activeThread.id) || activeThread
    : null


  const toggleSidebar = useCallback(() => setIsSidebarOpen((p) => !p), [])
  const toggleInfo = useCallback(() => {
    setIsInfoOpen((p) => !p)
    if (!isInfoOpen) setActiveThread(null) // close thread when opening info
  }, [isInfoOpen])
  const openDetails = useCallback(() => setShowGroupDetails(true), [])
  const closeDetails = useCallback(() => setShowGroupDetails(false), [])
  const openCommandPalette = useCommandPaletteStore((s) => s.open)

  return (
    <ErrorBoundary>
      <div className="flex h-[100dvh] w-full overflow-hidden bg-nexus-bg text-nexus-text relative isolate">
        {/* Ambient gradient */}
        <div className="absolute pointer-events-none inset-0 w-full h-full bg-gradient-to-br from-nexus-primary/[0.02] via-transparent to-black/20 z-0" />

        {/* Mobile sidebar overlay */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/50 backdrop-blur-sm md:hidden transition-opacity duration-300"
            onClick={toggleSidebar}
          />
        )}

        {/* Mobile info overlay */}
        {isInfoOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/50 backdrop-blur-sm md:hidden transition-opacity duration-300"
            onClick={toggleInfo}
          />
        )}

        {/* Sidebar */}
        <div
          className={`
            fixed inset-y-0 left-0 z-30 transform transition-transform duration-300 ease-out
            md:relative md:translate-x-0
            ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}
          `}
        >
          <Sidebar
            groups={groups}
            directChats={directChats}
            activeGroupId={activeGroupId}
            activeChatId={activeChatId}
            onlineUserIds={onlineUserIds}
            onSelectGroup={(id) => { setActiveGroupId(id); handleMobileAction() }}
            onSelectChat={(id) => { setActiveChatId(id); handleMobileAction() }}
            onSelectDirectChat={(id) => { selectDirectChat(id); handleMobileAction() }}
            onOpenUserSearch={() => setIsUserSearchOpen(true)}
            onNewGroup={(name) => { createGroup(name); handleMobileAction() }}
            onNewChat={(title) => { createChat(title); handleMobileAction() }}
            onJoinGroup={(id) => { joinGroup(id); handleMobileAction() }}
            onDeleteGroup={deleteGroup}
            onDeleteChat={deleteChat}
            onDeleteDirectChat={deleteDirectChat}
            userEmail={userEmail}
          />
        </div>

        {/* Main chat area */}
        <main id="main-content" className="flex flex-1 flex-col min-w-0 relative z-10">
          <ChatHeader
            title={activeChat.title}
            groupName={directChats.some((dc) => dc.chat_id === activeChatId) ? "Direct Message" : (activeGroup?.name || "")}
            typingUser={typingUser}
            onToggleSidebar={toggleSidebar}
            onToggleInfo={toggleInfo}
            onOpenDetails={openDetails}
            onOpenCommandPalette={openCommandPalette}
          />

          {isLoading ? (
            <div className="flex-1 flex items-center justify-center" role="status" aria-live="polite">
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-nexus-primary border-t-transparent" />
                <p className="text-nexus-muted text-sm">Loading messages...</p>
              </div>
            </div>
          ) : (
            <MessageList
              messages={activeChat.messages}
              isTyping={isTyping}
              typingUser={typingUser}
              streamingMessageId={streamingMessageId}
              userEmail={userEmail}
              userImage={profileImage}
              onReply={handleReply}
              onDelete={deleteMessage}
              onEdit={editMessage}
              onReact={handleReact}
              onOpenThread={handleOpenThread}
            />
          )}

          <MessageInput
            onSend={handleSend}
            disabled={isTyping}
            replyingTo={replyingTo}
            onCancelReply={cancelReply}
            chatId={activeChat.id}
            groupId={activeGroupId || undefined}
          />
        </main>

        {/* Right panel: Thread or Info */}
        <aside
          aria-label={activeThreadMessage ? "Thread conversation" : "Conversation details"}
          className={`
            hidden md:block border-l border-nexus-border bg-nexus-sidebar backdrop-blur-xl
            transition-all duration-300 ease-out overflow-hidden
            ${(isInfoOpen || activeThreadMessage) ? "w-80 opacity-100" : "w-0 opacity-0"}
          `}
        >
          {activeThreadMessage ? (
            <ThreadPanel
              parentMessage={activeThreadMessage}
              threadMessages={activeThreadMessage.thread_messages || []}
              currentUserEmail={userEmail}
              currentUserImage={profileImage}
              onSendReply={handleThreadReply}
              onClose={handleCloseThread}
              isLoading={isThreadLoading}
            />

          ) : isInfoOpen && activeGroup ? (
            <div className="w-80 h-full p-5">
              <h3 className="font-semibold text-sm mb-4">{activeGroup.name}</h3>
              <p className="text-xs text-nexus-muted mb-4">
                {(activeGroup.members || []).length} member{(activeGroup.members || []).length !== 1 ? "s" : ""}
              </p>
              <div className="space-y-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-nexus-muted">Members</p>
                {(activeGroup.members || []).map((m) => (
                  <div key={m} className="flex items-center gap-2.5 py-1.5">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-nexus-primary/30 to-purple-500/20 flex items-center justify-center text-[10px] font-bold text-nexus-text/70">
                      {m.substring(0, 2).toUpperCase()}
                    </div>
                    <span className="text-sm text-nexus-text/80 truncate">{m}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </aside>

        {/* Info Panel - mobile bottom sheet */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Conversation details"
          className={`
            md:hidden fixed bottom-0 left-0 right-0 z-40 bg-nexus-card/95 backdrop-blur-xl
            rounded-t-2xl border-t border-nexus-border/50 shadow-2xl
            transition-transform duration-300 ease-out max-h-[70vh] overflow-y-auto
            ${isInfoOpen ? "translate-y-0" : "translate-y-full"}
          `}
        >
          <div className="w-10 h-1 bg-nexus-border rounded-full mx-auto my-3" />
          {activeGroup && (
            <div className="px-5 pb-6">
              <h3 className="font-semibold mb-1">{activeGroup.name}</h3>
              <p className="text-xs text-nexus-muted mb-4">
                {(activeGroup.members || []).length} member{(activeGroup.members || []).length !== 1 ? "s" : ""}
              </p>
              <div className="space-y-2">
                {(activeGroup.members || []).map((m) => (
                  <div key={m} className="flex items-center gap-2.5 py-1.5">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-nexus-primary/30 to-purple-500/20 flex items-center justify-center text-xs font-bold text-nexus-text/70">
                      {m.substring(0, 2).toUpperCase()}
                    </div>
                    <span className="text-sm text-nexus-text/80 truncate">{m}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Mobile Thread Panel overlay / drawer */}
        {activeThreadMessage && (
          <div
            onClick={handleCloseThread}
            className="md:hidden fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md h-full bg-nexus-sidebar/95 backdrop-blur-xl shadow-2xl flex flex-col animate-[slideInRight_0.2s_ease-out]"
            >
              <ThreadPanel
                parentMessage={activeThreadMessage}
                threadMessages={activeThreadMessage.thread_messages || []}
                currentUserEmail={userEmail}
                currentUserImage={profileImage}
                onSendReply={handleThreadReply}
                onClose={handleCloseThread}
                isLoading={isThreadLoading}
              />
            </div>
          </div>
        )}

        {/* Group Details Modal */}
        {activeGroup && (
          <GroupDetailsModal
            isOpen={showGroupDetails}
            onClose={closeDetails}
            group={activeGroup}
            currentUserEmail={userEmail}
            onLeave={leaveGroup}
            onRemoveMember={removeMember}
          />
        )}

        {/* User Search Modal (Direct Messages) */}
        <UserSearchModal
          isOpen={isUserSearchOpen}
          onClose={() => setIsUserSearchOpen(false)}
          onSelectUser={(user) => {
            createOrOpenDirectChat(user.id)
            handleMobileAction()
          }}
        />
      </div>
    </ErrorBoundary>
  )
}
