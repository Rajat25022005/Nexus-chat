import { useState } from "react"
import Sidebar from "./Sidebar"
import ChatHeader from "./ChatHeader"
import MessageList from "./MessageList"
import MessageInput from "./MessageInput"
import { useWorkspace } from "../hooks/useWorkspace"
import { ErrorBoundary } from "../components/ErrorBoundary"

export default function ChatLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const {
    groups,
    activeChat,
    activeGroupId,
    activeChatId,
    setActiveGroupId,
    setActiveChatId,
    isTyping,
    sendMessage,
    createGroup,
    createChat,
    joinGroup,
    isAiDisabled,
    setIsAiDisabled,
    userEmail,
    username,
    deleteGroup,
    deleteChat,
  } = useWorkspace()

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
            userEmail={userEmail}
            username={username}
            onDeleteGroup={deleteGroup}
            onDeleteChat={deleteChat}
          />
        )}

        <div className="flex flex-1 flex-col">
          <ChatHeader
            title={activeChat.title}
            isAiDisabled={isAiDisabled}
            onToggleAi={() => setIsAiDisabled(!isAiDisabled)}
            onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          />
          <MessageList messages={activeChat.messages} isTyping={isTyping} userEmail={userEmail} />
          <MessageInput onSend={sendMessage} disabled={isTyping} />
        </div>
      </div>
    </ErrorBoundary>
  )
}
