import { useState } from "react"
import Sidebar from "./Sidebar"
import ChatHeader from "./ChatHeader"
import MessageList from "./MessageList"
import MessageInput from "./MessageInput"
import { useWorkspace } from "../hooks/useWorkspace"
import { ErrorBoundary } from "../components/ErrorBoundary"
import GroupDetailsModal from "../components/GroupDetailsModal"

export default function ChatLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [showGroupDetails, setShowGroupDetails] = useState(false)

  const {
    groups,
    activeChat,
    activeGroup,
    activeGroupId,
    activeChatId,
    setActiveGroupId,
    setActiveChatId,
    isTyping,
    sendMessage,
    createGroup,
    createChat,
    joinGroup,
    userEmail,
    username,
    deleteGroup,
    deleteChat,
    leaveGroup,
    removeMember,
    profileImage,
    deleteMessage,
    editMessage
  } = useWorkspace()

  /* Reply State */
  const [replyingTo, setReplyingTo] = useState<any | null>(null) // Using any temporarily to avoid import cycle if needed, but optimally Message

  const handleReply = (message: any) => {
    setReplyingTo(message)
  }

  const cancelReply = () => {
    setReplyingTo(null)
  }

  /* Wrap sendMessage to include replyTo if existing */
  const handleSend = (text: string, triggerAi: boolean) => {
    sendMessage(text, triggerAi, replyingTo ? {
      id: replyingTo.id,
      sender: replyingTo.sender_name || replyingTo.sender,
      content: replyingTo.content
    } : undefined)
    setReplyingTo(null)
  }

  return (
    <ErrorBoundary>
      <div className="flex h-screen overflow-hidden bg-nexus-bg text-nexus-text">
        {isSidebarOpen && (
          <Sidebar
            groups={groups}
            activeGroupId={activeGroupId}
            activeChatId={activeChatId}
            onSelectGroup={setActiveGroupId}
            onSelectChat={setActiveChatId}
            onNewGroup={createGroup}
            onNewChat={createChat}
            onJoinGroup={joinGroup}
            onDeleteGroup={deleteGroup}
            onDeleteChat={deleteChat}
          />
        )}

        <div className="flex flex-1 flex-col">
          <ChatHeader
            title={activeChat.title}
            onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
            onOpenDetails={() => setShowGroupDetails(true)}
          />
          <MessageList
            messages={activeChat.messages}
            isTyping={isTyping}
            userEmail={userEmail}
            userImage={profileImage}
            onReply={handleReply}
            onDelete={deleteMessage}
            onEdit={editMessage}
          />
          <MessageInput
            onSend={handleSend}
            disabled={isTyping}
            replyingTo={replyingTo}
            onCancelReply={cancelReply}
          />
        </div>

        {/* Group Details Modal */}
        {activeGroup && (
          <GroupDetailsModal
            isOpen={showGroupDetails}
            onClose={() => setShowGroupDetails(false)}
            group={activeGroup}
            currentUserEmail={userEmail}
            onLeave={leaveGroup}
            onRemoveMember={removeMember}
          />
        )}
      </div>
    </ErrorBoundary>
  )
}
