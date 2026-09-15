defmodule NexusSocket.E2EWorkloadTest do
  use ExUnit.Case, async: false

  alias NexusSocket.Auth.Jwt
  alias NexusSocket.Auth.Cache
  alias NexusSocket.Channels.ChannelHandler
  alias NexusSocket.Presence.Tracker, as: PresenceTracker
  alias NexusSocket.AiStreamBuffer

  describe "Tier 4: Real-World Workload Scenarios" do
    test "Scenario 1: Full Chat Lifecycle (Auth, Join, Message, Ack, React, Edit, Delete)" do
      # 1. Generate JWT tokens for two clients
      {:ok, token_alice} = Jwt.sign(%{"user_id" => "usr-alice", "email" => "alice@nexus.test"}, 3600)
      {:ok, token_bob} = Jwt.sign(%{"user_id" => "usr-bob", "email" => "bob@nexus.test"}, 3600)

      # 2. Authenticate both clients (hits cache on subsequent verifications)
      assert {:ok, claims_alice} = Cache.authenticate(token_alice)
      assert {:ok, claims_bob} = Cache.authenticate(token_bob)

      user_alice = %{user_id: claims_alice["user_id"], email: claims_alice["email"], name: "Alice"}
      user_bob = %{user_id: claims_bob["user_id"], email: claims_bob["email"], name: "Bob"}

      chat_id = "lifecycle-chat-42"
      topic = "chat:#{chat_id}"

      # 3. Bob subscribes to room topic
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, topic)

      # 4. Alice joins chat
      state_alice = %{joined_rooms: MapSet.new()}
      assert {:noreply, state_alice} = ChannelHandler.handle_event("join_chat", %{"chatId" => chat_id}, user_alice, state_alice)

      # Bob sees Alice join
      assert_receive {:socket_broadcast, "user_joined", joined_event}
      assert joined_event["userId"] == "usr-alice"

      # 5. Alice sends a message with an acknowledgment callback
      msg_payload = %{"chatId" => chat_id, "content" => "Hello Bob!", "tempId" => "t-1"}
      assert {:reply, ack, state_alice} = ChannelHandler.handle_event("send_message", msg_payload, user_alice, state_alice)
      assert ack["success"] == true
      msg_id = ack["messageId"]

      # Bob receives the new_message broadcast
      assert_receive {:socket_broadcast, "new_message", msg_event}
      assert msg_event["id"] == msg_id
      assert msg_event["content"] == "Hello Bob!"

      # 6. Bob reacts to Alice's message
      state_bob = %{joined_rooms: MapSet.new([topic])}
      react_payload = %{"chatId" => chat_id, "messageId" => msg_id, "emoji" => "🔥", "action" => "add"}
      assert {:reply, react_ack, _new_state_bob} = ChannelHandler.handle_event("react_message", react_payload, user_bob, state_bob)
      assert react_ack["success"] == true

      # Alice & Bob receive reaction broadcast
      assert_receive {:socket_broadcast, "message_reacted", reaction}
      assert reaction["messageId"] == msg_id
      assert reaction["emoji"] == "🔥"
      assert reaction["userId"] == "usr-bob"

      # 7. Alice edits her message
      edit_payload = %{"chatId" => chat_id, "messageId" => msg_id, "content" => "Hello Bob! (edited)"}
      assert {:noreply, state_alice} = ChannelHandler.handle_event("edit_message", edit_payload, user_alice, state_alice)

      assert_receive {:socket_broadcast, "message_updated", updated}
      assert updated["id"] == msg_id
      assert updated["content"] == "Hello Bob! (edited)"

      # 8. Alice deletes the message
      del_payload = %{"chatId" => chat_id, "messageId" => msg_id, "deleteType" => "everyone"}
      assert {:noreply, _} = ChannelHandler.handle_event("delete_message", del_payload, user_alice, state_alice)

      assert_receive {:socket_broadcast, "message_deleted", deleted}
      assert deleted["id"] == msg_id
    end

    test "Scenario 2: Presence Synchronization & Abnormal Disconnect Reconciliation" do
      topic = "chat:presence-sync"

      # Client A and Client B join and track presence
      pid_a = spawn(fn ->
        PresenceTracker.track(self(), topic, "user-sync-a", %{name: "Sync A", email: "a@sync.test"})
        receive do :stop -> :ok end
      end)

      pid_b = spawn(fn ->
        PresenceTracker.track(self(), topic, "user-sync-b", %{name: "Sync B", email: "b@sync.test"})
        receive do :stop -> :ok end
      end)

      Process.sleep(50)
      online = PresenceTracker.list_online(topic)
      assert length(online) == 2
      assert Enum.any?(online, &(&1.uid == "user-sync-a"))
      assert Enum.any?(online, &(&1.uid == "user-sync-b"))

      # Simulate abnormal disconnect of Client A (unhandled exit)
      Process.exit(pid_a, :kill)
      Process.sleep(50)

      # CRDT reconciles presence list without DB access
      online_after = PresenceTracker.list_online(topic)
      assert length(online_after) == 1
      assert hd(online_after).uid == "user-sync-b"

      # Clean up B
      send(pid_b, :stop)
    end

    test "Scenario 3: High-Frequency AI Streaming Under Concurrent Load" do
      num_chats = 5
      tokens_per_chat = 10

      # Subscribe to all test chats
      for c <- 1..num_chats do
        Phoenix.PubSub.subscribe(NexusSocket.PubSub, "chat:load-#{c}")
      end

      # Concurrently push tokens across chats
      tasks =
        for c <- 1..num_chats do
          Task.async(fn ->
            chat_id = "load-#{c}"
            msg_id = "msg-load-#{c}"

            for t <- 1..tokens_per_chat do
              is_final = t == tokens_per_chat
              AiStreamBuffer.push(chat_id, msg_id, "tok#{t} ", is_final)
            end
          end)
        end

      Task.await_many(tasks)

      # Each chat should have completed and received its final chunk
      for c <- 1..num_chats do
        chat_id = "load-#{c}"
        assert_receive {:socket_broadcast, "ai_stream_chunk", %{chatId: ^chat_id, isFinal: true}}, 1000
      end
    end

    test "Scenario 4: Connection Crash Isolation & Supervisor Recovery" do
      root_pid = Process.whereis(NexusSocket.Supervisor)
      assert Process.alive?(root_pid)

      # 1. Normal client connection process
      parent = self()
      client1 =
        spawn(fn ->
          receive do
            {:ping, from} -> send(from, :pong)
          end
        end)

      # 2. Rogue client process under monitor that crashes unexpectedly
      {rogue_pid, rogue_ref} =
        spawn_monitor(fn ->
          raise "Unexpected client parse error"
        end)

      # Rogue client crashes with runtime error
      assert_receive {:DOWN, ^rogue_ref, :process, ^rogue_pid, _reason}

      # Client 1 must remain completely unaffected and healthy
      send(client1, {:ping, parent})
      assert_receive :pong, 500

      # Application supervisor must remain alive and undisturbed
      assert Process.alive?(root_pid)
    end

    test "Scenario 5: Cache Stampede & Atomic ETS TTL Expiration" do
      Cache.clear()

      # Create 1 shared token
      {:ok, token} = Jwt.sign(%{"user_id" => "stampede-user", "email" => "stampede@test.com"}, 1)

      # Simulate 50 concurrent requests hitting authenticate simultaneously (cache stampede)
      tasks =
        for _ <- 1..50 do
          Task.async(fn ->
            Cache.authenticate(token)
          end)
        end

      results = Task.await_many(tasks)
      Enum.each(results, fn res ->
        assert {:ok, claims} = res
        assert claims["user_id"] == "stampede-user"
      end)

      # Only 1 entry was stored in ETS
      assert Cache.count() == 1

      # Wait for token TTL to expire (1 second + buffer)
      Process.sleep(1200)

      # Atomic sweep evicts expired entry
      evicted = Cache.sweep_expired()
      assert evicted == 1
      assert Cache.count() == 0
    end
  end
end
