import Sidebar from "./Sidebar"
import ChatHeader from "./ChatHeader"
import MessageList from "./MessageList"
import MessageInput from "./MessageInput"
import { useWorkspace } from "../hooks/useWorkspace"
import { ErrorBoundary } from "../components/ErrorBoundary"

export default function ChatLayout() {
  const {
    groups,
    activeChat,
    activeGroupId,
    activeChatId,
    setActiveGroupId,
    setActiveChatId,
    isTyping,
    isConnected,
    error,
    sendMessage,
    createGroup,
    createChat,
  } = useWorkspace()

  return (
    <ErrorBoundary>
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
          <ChatHeader title={activeChat.title} isConnected={isConnected} />

          {error && (
            <div className="bg-red-500/10 px-4 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <MessageList messages={activeChat.messages} isTyping={isTyping} />
          <MessageInput onSend={sendMessage} disabled={isTyping || !isConnected} />
        </div>
      </div>
    </ErrorBoundary>
  )
}
