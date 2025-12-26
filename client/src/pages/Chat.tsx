import ChatLayout from "../chat/ChatLayout"
import Sidebar from "../chat/Sidebar"
import ChatHeader from "../chat/ChatHeader"
import MessageList from "../chat/MessageList"
import MessageInput from "../chat/MessageInput"

export default function Chat() {
  return (
    <ChatLayout
      sidebar={<Sidebar />}
      header={<ChatHeader />}
      messages={<MessageList />}
      input={<MessageInput />}
    />
  )
}
