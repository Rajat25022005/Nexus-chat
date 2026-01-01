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
    sendMessage,
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
        <ChatHeader title={activeChat.title} />
        <MessageList messages={activeChat.messages} isTyping={isTyping} />
        <MessageInput onSend={sendMessage} disabled={isTyping} />
      </div>
    </div>
  )
}
