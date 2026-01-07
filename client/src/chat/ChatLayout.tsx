import Sidebar from "./Sidebar"
import ChatHeader from "./ChatHeader"
import MessageList from "./MessageList"
import MessageInput from "./MessageInput"
import { useWorkspace } from "../hooks/useWorkspace"

export default function ChatLayout() {
  const {
    groups,
    activeChat,
    activeGroupId,
    activeChatId,
    setActiveGroupId,
    setActiveChatId,
    isTyping,
    typingUsers,
    isConnected,
    sendMessage,
    startTyping,
    stopTyping,
    createGroup,
    createChat,
  } = useWorkspace()

  return (
    <div className="flex h-screen overflow-hidden bg-nexus-bg text-nexus-text">
      <Sidebar
        groups={groups}
        activeGroupId={activeGroupId}
        activeChatId={activeChatId}
        onSelectGroup={setActiveGroupId}
        onSelectChat={setActiveChatId}
        onNewGroup={createGroup}
        onNewChat={createChat}
      />

      <div className="flex flex-1 flex-col">
        {/* Header with connection status */}
        <div className="flex items-center justify-between border-b border-nexus-border bg-nexus-header px-6 py-4">
          <ChatHeader title={activeChat.title} />
          
          <div className="flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full ${
                isConnected ? "bg-green-500" : "bg-red-500"
              }`}
            />
            <span className="text-xs text-nexus-muted">
              {isConnected ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>

        <MessageList
          messages={activeChat.messages}
          isTyping={isTyping}
          typingUsers={typingUsers}
        />

        <MessageInput
          onSend={sendMessage}
          disabled={isTyping || !isConnected}
          onTypingStart={startTyping}
          onTypingStop={stopTyping}
        />
      </div>
    </div>
  )
}