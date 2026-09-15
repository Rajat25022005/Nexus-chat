defmodule NexusSocket.ChannelMessagingTest do
  use ExUnit.Case, async: false
  alias NexusSocket.Channels.ChannelHandler

  setup do
    user = %{
      user_id: "user-123",
      email: "user@test.com",
      name: "Test User"
    }

    initial_state = %{
      joined_rooms: MapSet.new()
    }

    %{user: user, state: initial_state}
  end

  describe "Room Join & Leave Lifecycle" do
    test "join_chat subscribes to room and broadcasts user_joined", %{user: user, state: state} do
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, "chat:room-1")

      payload = %{"chatId" => "room-1", "groupId" => "grp-1"}
      assert {:noreply, new_state} = ChannelHandler.handle_event("join_chat", payload, user, state)
      assert MapSet.member?(new_state.joined_rooms, "chat:room-1")

      # Verify broadcast
      assert_receive {:socket_broadcast, "user_joined", data}
      assert data["userId"] == "user-123"
      assert data["chatId"] == "room-1"
    end

    test "leave_chat unregisters from room and broadcasts user_left", %{user: user, state: state} do
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, "chat:room-leave")
      state = %{state | joined_rooms: MapSet.new(["chat:room-leave"])}

      payload = %{"chatId" => "room-leave"}
      assert {:noreply, new_state} = ChannelHandler.handle_event("leave_chat", payload, user, state)
      refute MapSet.member?(new_state.joined_rooms, "chat:room-leave")

      assert_receive {:socket_broadcast, "user_left", data}
      assert data["userId"] == "user-123"
      assert data["chatId"] == "room-leave"
    end
  end

  describe "Real-Time Chat & Acks (F8)" do
    test "send_message broadcasts new_message and returns success ack", %{user: user, state: state} do
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, "chat:room-msg")

      payload = %{
        "chatId" => "room-msg",
        "content" => "Hello Nexus Chat!",
        "tempId" => "temp-101",
        "groupId" => "grp-msg"
      }

      assert {:reply, ack, _new_state} = ChannelHandler.handle_event("send_message", payload, user, state)
      assert ack["success"] == true
      assert ack["status"] == "ok"
      assert is_binary(ack["messageId"])

      # Verify room broadcast received
      assert_receive {:socket_broadcast, "new_message", msg}
      assert msg["content"] == "Hello Nexus Chat!"
      assert msg["chatId"] == "room-msg"
      assert msg["tempId"] == "temp-101"
      assert msg["userId"] == "user-123"
      assert msg["role"] == "user"
      assert is_binary(msg["createdAt"])
    end

    test "send_message with triggerAI emits AI typing indicator", %{user: user, state: state} do
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, "chat:room-ai")

      payload = %{
        "chatId" => "room-ai",
        "content" => "What is Elixir?",
        "triggerAI" => true
      }

      assert {:reply, ack, _} = ChannelHandler.handle_event("send_message", payload, user, state)
      assert ack["success"] == true

      # Should broadcast new_message AND typing_indicator for AI assistant
      assert_receive {:socket_broadcast, "new_message", _}
      assert_receive {:socket_broadcast, "typing_indicator", typing}
      assert typing["userId"] == "ai-assistant"
      assert typing["isTyping"] == true
    end

    test "send_message rejects empty content", %{user: user, state: state} do
      payload = %{"chatId" => "room-1", "content" => ""}
      assert {:reply, ack, _} = ChannelHandler.handle_event("send_message", payload, user, state)
      assert ack["success"] == false
      assert String.contains?(ack["error"], "required")
    end
  end

  describe "Message Edits, Deletions, Reactions & Threads (F9)" do
    test "edit_message broadcasts both message_updated and message_edited", %{user: user, state: state} do
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, "chat:room-edit")

      payload = %{
        "messageId" => "m-edit-1",
        "chatId" => "room-edit",
        "content" => "Updated message content",
        "groupId" => "grp-1"
      }

      assert {:noreply, _} = ChannelHandler.handle_event("edit_message", payload, user, state)

      assert_receive {:socket_broadcast, "message_updated", updated}
      assert updated["id"] == "m-edit-1"
      assert updated["content"] == "Updated message content"
      assert updated["is_edited"] == true

      assert_receive {:socket_broadcast, "message_edited", legacy}
      assert legacy["messageId"] == "m-edit-1"
      assert legacy["content"] == "Updated message content"
      assert legacy["editedBy"] == "user-123"
    end

    test "delete_message broadcasts message_deleted", %{user: user, state: state} do
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, "chat:room-del")

      payload = %{
        "messageId" => "m-del-1",
        "chatId" => "room-del",
        "deleteType" => "everyone"
      }

      assert {:noreply, _} = ChannelHandler.handle_event("delete_message", payload, user, state)

      assert_receive {:socket_broadcast, "message_deleted", deleted}
      assert deleted["id"] == "m-del-1"
      assert deleted["type"] == "everyone"
      assert deleted["chatId"] == "room-del"
    end

    test "react_message broadcasts message_reacted and returns ack", %{user: user, state: state} do
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, "chat:room-react")

      payload = %{
        "messageId" => "m-react-1",
        "chatId" => "room-react",
        "emoji" => "🚀",
        "action" => "add"
      }

      assert {:reply, ack, _} = ChannelHandler.handle_event("react_message", payload, user, state)
      assert ack["success"] == true
      assert ack["action"] == "add"

      assert_receive {:socket_broadcast, "message_reacted", reaction}
      assert reaction["messageId"] == "m-react-1"
      assert reaction["emoji"] == "🚀"
      assert reaction["userId"] == "user-123"
      assert reaction["action"] == "add"
    end

    test "send_thread_reply broadcasts thread_reply and returns ack", %{user: user, state: state} do
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, "chat:room-thread")

      payload = %{
        "parentMessageId" => "parent-m-1",
        "chatId" => "room-thread",
        "content" => "Thread reply content",
        "tempId" => "reply-temp-1"
      }

      assert {:reply, ack, _} = ChannelHandler.handle_event("send_thread_reply", payload, user, state)
      assert ack["success"] == true
      assert is_binary(ack["replyId"])

      assert_receive {:socket_broadcast, "thread_reply", thread}
      assert thread["parentMessageId"] == "parent-m-1"
      assert thread["reply"]["content"] == "Thread reply content"
      assert thread["reply"]["userId"] == "user-123"
    end
  end

  describe "Typing Indicators (F10)" do
    test "typing_start broadcasts typing_indicator with isTyping: true", %{user: user, state: state} do
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, "chat:room-type")

      payload = %{"chatId" => "room-type"}
      assert {:noreply, _} = ChannelHandler.handle_event("typing_start", payload, user, state)

      assert_receive {:socket_broadcast, "typing_indicator", typing}
      assert typing["isTyping"] == true
      assert typing["userId"] == "user-123"
      assert typing["chatId"] == "room-type"
    end

    test "typing_stop broadcasts typing_indicator with isTyping: false", %{user: user, state: state} do
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, "chat:room-type")

      payload = %{"chatId" => "room-type"}
      assert {:noreply, _} = ChannelHandler.handle_event("typing_stop", payload, user, state)

      assert_receive {:socket_broadcast, "typing_indicator", typing}
      assert typing["isTyping"] == false
      assert typing["userId"] == "user-123"
    end
  end
end
