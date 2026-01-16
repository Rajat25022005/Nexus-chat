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
    joinGroup,
    isAiDisabled,
    setIsAiDisabled,
    userEmail,
    deleteGroup,
    deleteChat,
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
        onJoinGroup={joinGroup}
        userEmail={userEmail}
        onDeleteGroup={deleteGroup}
        onDeleteChat={deleteChat}
      />

      <div className="flex flex-1 flex-col">
        <ChatHeader
          title={activeChat.title}
          isAiDisabled={isAiDisabled}
          onToggleAi={() => setIsAiDisabled(!isAiDisabled)}
        />
        <MessageList messages={activeChat.messages} isTyping={isTyping} userEmail={userEmail} />
        <MessageInput onSend={sendMessage} disabled={isTyping} />
      </div>
    </div>
  )
}
