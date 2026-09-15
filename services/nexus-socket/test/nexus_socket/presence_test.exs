defmodule NexusSocket.PresenceTest do
  use ExUnit.Case, async: false
  alias NexusSocket.Presence.Tracker, as: PresenceTracker
  alias NexusSocket.Channels.ChatChannel

  describe "Phoenix.Tracker Delta-CRDT Presence (F6 / F7)" do
    test "tracks user presence and lists online users in chat topic" do
      topic = ChatChannel.chat_topic("room-alpha")
      user_id = "usr-101"
      meta = %{name: "Alice", email: "alice@nexus.test", online_at: 1_700_000}

      # Track current process
      assert {:ok, _} = PresenceTracker.track(self(), topic, user_id, meta)

      # List online users
      online = PresenceTracker.list_online(topic)
      assert length(online) >= 1
      assert Enum.any?(online, fn u -> u.uid == "usr-101" and u.name == "Alice" end)

      # Untrack
      assert :ok = PresenceTracker.untrack(self(), topic, user_id)
    end

    test "tracks multiple users concurrently in the same chat room" do
      topic = ChatChannel.chat_topic("multi-room")

      # Spawn 3 separate tracking processes
      pids =
        for i <- 1..3 do
          parent = self()
          spawn(fn ->
            PresenceTracker.track(self(), topic, "user-#{i}", %{name: "User #{i}", email: "u#{i}@test.com"})
            send(parent, {:tracked, i})
            receive do
              :stop -> :ok
            end
          end)
        end

      for i <- 1..3 do
        assert_receive {:tracked, ^i}, 1000
      end

      # Wait briefly for Tracker CRDT convergence
      Process.sleep(50)
      online = PresenceTracker.list_online(topic)
      assert length(online) == 3

      # Stop the child processes
      Enum.each(pids, fn pid -> send(pid, :stop) end)
      Process.sleep(50)

      # Presences should be cleaned up automatically after process exit
      online_after = PresenceTracker.list_online(topic)
      assert length(online_after) == 0
    end

    test "isolates presences between different rooms" do
      topic_a = ChatChannel.chat_topic("room-isolated-a")
      topic_b = ChatChannel.chat_topic("room-isolated-b")

      PresenceTracker.track(self(), topic_a, "user-a", %{name: "User A", email: "a@test.com"})

      Process.sleep(30)
      assert length(PresenceTracker.list_online(topic_a)) >= 1
      assert length(PresenceTracker.list_online(topic_b)) == 0

      PresenceTracker.untrack(self(), topic_a, "user-a")
    end

    test "generates correct topic strings via ChatChannel helper (F7)" do
      assert ChatChannel.chat_topic("c123") == "chat:c123"
      assert ChatChannel.group_topic("g456") == "group:g456"
      assert ChatChannel.workspace_topic("w789") == "workspace:w789"
    end
  end
end
