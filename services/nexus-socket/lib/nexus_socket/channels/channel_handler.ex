defmodule NexusSocket.Channels.ChannelHandler do
  @moduledoc """
  Event router and business logic coordinator for incoming Socket.IO events.

  Handles chat rooms, messaging, message editing/deleting, emoji reactions,
  thread replies, typing indicators, and presence tracking.
  """

  alias NexusSocket.Presence.Tracker, as: PresenceTracker

  @type user_context :: %{
          user_id: String.t(),
          email: String.t(),
          name: String.t()
        }

  @doc """
  Handles an incoming event tuple `[event_name, payload]` from an authenticated client.
  Returns `{:ok, state, ack_payload}` or `{:ok, state}` or `{:error, reason}`.
  """
  @spec handle_event(String.t(), term(), user_context(), map()) ::
          {:reply, term(), map()} | {:noreply, map()} | {:error, term(), map()}
  def handle_event("join_chat", payload, user, state) when is_map(payload) do
    chat_id = Map.get(payload, "chatId")
    group_id = Map.get(payload, "groupId")

    if is_binary(chat_id) and byte_size(chat_id) > 0 do
      chat_topic = "chat:#{chat_id}"
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, chat_topic)

      if is_binary(group_id) and byte_size(group_id) > 0 do
        Phoenix.PubSub.subscribe(NexusSocket.PubSub, "group:#{group_id}")
      end

      # Track user presence in the chat room
      PresenceTracker.track(self(), chat_topic, user.user_id, %{
        name: user.name,
        email: user.email,
        online_at: System.system_time(:second)
      })

      # Broadcast user_joined
      broadcast(chat_topic, "user_joined", %{
        "userId" => user.user_id,
        "name" => user.name,
        "chatId" => chat_id
      })

      joined_rooms = MapSet.put(state.joined_rooms, chat_topic)
      new_state = %{state | joined_rooms: joined_rooms}
      {:noreply, new_state}
    else
      broadcast_error(state, "chatId is required to join chat")
      {:noreply, state}
    end
  end

  def handle_event("leave_chat", payload, user, state) when is_map(payload) do
    chat_id = Map.get(payload, "chatId")

    if is_binary(chat_id) and byte_size(chat_id) > 0 do
      chat_topic = "chat:#{chat_id}"
      PresenceTracker.untrack(self(), chat_topic, user.user_id)

      broadcast(chat_topic, "user_left", %{
        "userId" => user.user_id,
        "name" => user.name,
        "chatId" => chat_id
      })

      Phoenix.PubSub.unsubscribe(NexusSocket.PubSub, chat_topic)
      joined_rooms = MapSet.delete(state.joined_rooms, chat_topic)
      {:noreply, %{state | joined_rooms: joined_rooms}}
    else
      {:noreply, state}
    end
  end

  def handle_event("send_message", payload, user, state) when is_map(payload) do
    chat_id = Map.get(payload, "chatId")
    content = Map.get(payload, "content", "")
    temp_id = Map.get(payload, "tempId")
    group_id = Map.get(payload, "groupId")
    tenant_id = Map.get(payload, "tenantId")
    workspace_id = Map.get(payload, "workspaceId")
    trigger_ai = Map.get(payload, "triggerAI", false)
    reply_to = Map.get(payload, "replyTo")
    current_uid = get_user_id(user)

    if is_binary(chat_id) and byte_size(chat_id) > 0 and is_binary(content) and byte_size(content) > 0 do
      message_id = generate_uuid()
      now_iso = DateTime.utc_now() |> DateTime.to_iso8601()

      message_payload =
        %{
          "id" => message_id,
          "chatId" => chat_id,
          "content" => content,
          "role" => "user",
          "userId" => current_uid,
          "userEmail" => user.email,
          "userName" => user.name,
          "createdAt" => now_iso
        }
        |> maybe_put("tempId", temp_id)
        |> maybe_put("groupId", group_id)
        |> maybe_put("tenantId", tenant_id)
        |> maybe_put("workspaceId", workspace_id)
        |> maybe_put("replyTo", reply_to)

      # Broadcast new message to the chat room
      broadcast("chat:#{chat_id}", "new_message", message_payload)

      if trigger_ai do
        broadcast("chat:#{chat_id}", "typing_indicator", %{
          "userId" => "ai-assistant",
          "name" => "Nexus AI",
          "chatId" => chat_id,
          "isTyping" => true
        })
      end

      ack_data = %{
        "success" => true,
        "messageId" => message_id,
        "status" => "ok"
      }

      {:reply, ack_data, state}
    else
      {:reply, %{"success" => false, "error" => "chatId and content are required"}, state}
    end
  end

  def handle_event("edit_message", payload, user, state) when is_map(payload) do
    message_id = Map.get(payload, "messageId")
    chat_id = Map.get(payload, "chatId")
    content = Map.get(payload, "content", "")
    group_id = Map.get(payload, "groupId")
    author_id = Map.get(payload, "authorId") || Map.get(payload, "userId") || Map.get(payload, "senderId")
    current_uid = get_user_id(user)

    cond do
      is_binary(author_id) and byte_size(author_id) > 0 and author_id != current_uid ->
        {:reply, %{"success" => false, "error" => "Unauthorized: cannot edit another user's message"}, state}

      is_binary(message_id) and byte_size(message_id) > 0 and
      is_binary(chat_id) and byte_size(chat_id) > 0 and
      is_binary(content) and byte_size(content) > 0 ->
        chat_topic = "chat:#{chat_id}"

        # Emit both message_updated (React client) and message_edited (legacy Node)
        broadcast(chat_topic, "message_updated", %{
          "id" => message_id,
          "content" => content,
          "chat_id" => chat_id,
          "group_id" => group_id,
          "is_edited" => true
        })

        broadcast(chat_topic, "message_edited", %{
          "messageId" => message_id,
          "chatId" => chat_id,
          "content" => content,
          "editedBy" => current_uid
        })

        {:noreply, state}

      true ->
        {:reply, %{"success" => false, "error" => "messageId, chatId, and non-empty content are required"}, state}
    end
  end

  def handle_event("delete_message", payload, user, state) when is_map(payload) do
    message_id = Map.get(payload, "messageId")
    chat_id = Map.get(payload, "chatId")
    delete_type = Map.get(payload, "deleteType", "everyone")
    author_id = Map.get(payload, "authorId") || Map.get(payload, "userId") || Map.get(payload, "senderId")
    current_uid = get_user_id(user)

    cond do
      is_binary(author_id) and byte_size(author_id) > 0 and author_id != current_uid ->
        {:reply, %{"success" => false, "error" => "Unauthorized: cannot delete another user's message"}, state}

      is_binary(message_id) and byte_size(message_id) > 0 and
      is_binary(chat_id) and byte_size(chat_id) > 0 ->
        broadcast("chat:#{chat_id}", "message_deleted", %{
          "id" => message_id,
          "messageId" => message_id,
          "type" => delete_type,
          "chatId" => chat_id,
          "deletedBy" => current_uid
        })

        {:noreply, state}

      true ->
        {:reply, %{"success" => false, "error" => "messageId and chatId are required"}, state}
    end
  end

  def handle_event("react_message", payload, user, state) when is_map(payload) do
    message_id = Map.get(payload, "messageId")
    chat_id = Map.get(payload, "chatId")
    emoji = Map.get(payload, "emoji")
    action = Map.get(payload, "action", "add")

    if is_binary(message_id) and is_binary(chat_id) and is_binary(emoji) do
      broadcast("chat:#{chat_id}", "message_reacted", %{
        "messageId" => message_id,
        "emoji" => emoji,
        "userId" => user.user_id,
        "action" => action
      })

      {:reply, %{"success" => true, "action" => action}, state}
    else
      {:reply, %{"success" => false, "error" => "messageId, chatId, and emoji required"}, state}
    end
  end

  def handle_event("send_thread_reply", payload, user, state) when is_map(payload) do
    parent_id = Map.get(payload, "parentMessageId")
    chat_id = Map.get(payload, "chatId")
    content = Map.get(payload, "content", "")
    temp_id = Map.get(payload, "tempId")
    current_uid = get_user_id(user)

    if is_binary(parent_id) and byte_size(parent_id) > 0 and
       is_binary(chat_id) and byte_size(chat_id) > 0 and
       is_binary(content) and byte_size(content) > 0 do
      reply_id = generate_uuid()
      now_iso = DateTime.utc_now() |> DateTime.to_iso8601()

      reply_data = %{
        "id" => reply_id,
        "tempId" => temp_id,
        "content" => content,
        "userId" => current_uid,
        "userEmail" => user.email,
        "userName" => user.name,
        "createdAt" => now_iso
      }

      broadcast("chat:#{chat_id}", "thread_reply", %{
        "parentMessageId" => parent_id,
        "reply" => reply_data
      })

      {:reply, %{"success" => true, "replyId" => reply_id}, state}
    else
      {:reply, %{"success" => false, "error" => "parentMessageId, chatId, and content required"}, state}
    end
  end

  def handle_event("typing_start", payload, user, state) when is_map(payload) do
    chat_id = Map.get(payload, "chatId")

    if is_binary(chat_id) and byte_size(chat_id) > 0 do
      broadcast("chat:#{chat_id}", "typing_indicator", %{
        "isTyping" => true,
        "userId" => user.user_id,
        "name" => user.name,
        "chatId" => chat_id
      })
    end

    {:noreply, state}
  end

  def handle_event("typing_stop", payload, user, state) when is_map(payload) do
    chat_id = Map.get(payload, "chatId")

    if is_binary(chat_id) and byte_size(chat_id) > 0 do
      broadcast("chat:#{chat_id}", "typing_indicator", %{
        "isTyping" => false,
        "userId" => user.user_id,
        "name" => user.name,
        "chatId" => chat_id
      })
    end

    {:noreply, state}
  end

  def handle_event("get_online_users", payload, _user, state) do
    chat_id = if is_map(payload), do: Map.get(payload, "chatId"), else: nil
    topic = if chat_id, do: "chat:#{chat_id}", else: "global"

    users = PresenceTracker.list_online(topic)
    {:reply, users, state}
  end

  def handle_event(_unknown_event, _payload, _user, state) do
    # Gracefully ignore unknown events
    {:noreply, state}
  end

  # --- Helpers ---

  defp broadcast(topic, event_name, payload) do
    Phoenix.PubSub.broadcast(
      NexusSocket.PubSub,
      topic,
      {:socket_broadcast, event_name, payload}
    )

    # Mirror to Redis Pub/Sub for cross-service consumption
    NexusSocket.Redis.publish("nexus:events", %{
      "topic" => topic,
      "event" => event_name,
      "payload" => payload
    })
  end

  defp broadcast_error(_state, message) do
    # Can send error_event to self
    send(self(), {:socket_broadcast, "error_event", %{"message" => message}})
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp generate_uuid do
    # Generate cryptographic random UUID v4
    <<u0::48, _::4, u1::12, _::2, u2::62>> = :crypto.strong_rand_bytes(16)
    <<u0::48, 4::4, u1::12, 2::2, u2::62>>
    |> Base.encode16(case: :lower)
    |> format_uuid()
  end

  defp format_uuid(
         <<p1::binary-size(8), p2::binary-size(4), p3::binary-size(4), p4::binary-size(4),
           p5::binary-size(12)>>
       ) do
    "#{p1}-#{p2}-#{p3}-#{p4}-#{p5}"
  end

  defp get_user_id(user) when is_map(user) do
    Map.get(user, :user_id) || Map.get(user, :uid) || Map.get(user, "user_id") || Map.get(user, "uid")
  end

  defp get_user_id(_), do: nil
end
