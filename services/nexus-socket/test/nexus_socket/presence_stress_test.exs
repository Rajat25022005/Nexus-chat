defmodule NexusSocket.PresenceStressTest do
  use ExUnit.Case, async: false

  alias NexusSocket.Presence.Tracker, as: PresenceTracker
  alias NexusSocket.Channels.ChatChannel

  @moduledoc """
  Empirical stress harness for Delta-CRDT presence tracking (Phoenix.Tracker)
  under heavy concurrency, rapid churn, and mixed chat/workspace topics.
  """

  describe "Delta-CRDT Presence Stress Testing" do
    test "Rapid concurrent joins and leaves across chat and workspace topics with high churn" do
      chat_topics = [
        ChatChannel.chat_topic("churn-chat-alpha"),
        ChatChannel.chat_topic("churn-chat-beta")
      ]

      workspace_topics = [
        ChatChannel.workspace_topic("churn-ws-1"),
        ChatChannel.workspace_topic("churn-ws-2")
      ]

      all_topics = chat_topics ++ workspace_topics
      num_clients = 60
      iterations_per_client = 15

      # Subscribe test runner to PubSub to verify diff broadcasts under load
      Enum.each(all_topics, fn topic ->
        Phoenix.PubSub.subscribe(NexusSocket.PubSub, topic)
      end)

      # Coordinator ETS table to maintain ground truth
      oracle_table = :ets.new(:presence_oracle, [:set, :public])

      parent = self()

      # Spawn 60 concurrent worker processes
      workers =
        for i <- 1..num_clients do
          spawn_link(fn ->
            user_id = "user-stress-#{i}"
            user_name = "StressUser #{i}"
            user_email = "user#{i}@stress.test"

            # Track currently joined topics for this worker
            worker_joined =
              Enum.reduce(1..iterations_per_client, MapSet.new(), fn iter, joined_set ->
                topic = Enum.at(all_topics, rem(i + iter, length(all_topics)))

                # If already joined to this topic, leave first (simulating room switching)
                joined_set =
                  if MapSet.member?(joined_set, topic) do
                    assert :ok = PresenceTracker.untrack(self(), topic, user_id)
                    :ets.delete(oracle_table, {user_id, topic})
                    MapSet.delete(joined_set, topic)
                  else
                    joined_set
                  end

                # Join topic
                track_res =
                  PresenceTracker.track(self(), topic, user_id, %{
                    name: user_name,
                    email: user_email,
                    online_at: System.system_time(:second)
                  })

                assert match?({:ok, _}, track_res),
                       "Expected {:ok, _}, got #{inspect(track_res)} for #{user_id} on #{topic}"
                :ets.insert(oracle_table, {{user_id, topic}, :joined})
                joined_set = MapSet.put(joined_set, topic)

                # Brief jitter simulating real-world network packet timing
                :timer.sleep(:rand.uniform(4))

                # On some iterations, leave immediately to generate intense churn
                if rem(iter, 3) == 0 do
                  untrack_res = PresenceTracker.untrack(self(), topic, user_id)
                  assert untrack_res == :ok
                  :ets.delete(oracle_table, {user_id, topic})
                  MapSet.delete(joined_set, topic)
                else
                  joined_set
                end
              end)

            send(parent, {:worker_done, i, worker_joined})

            # Keep process alive until release signal
            receive do
              :terminate -> :ok
            end
          end)
        end

      # Concurrently run readers calling list_online/1 while churn is active
      reader_task =
        Task.async(fn ->
          for _ <- 1..100 do
            for topic <- all_topics do
              online_users = PresenceTracker.list_online(topic)
              # Invariant: list_online/1 must always return a list of valid maps
              assert is_list(online_users)
              Enum.each(online_users, fn u ->
                assert is_binary(u.uid)
                assert is_binary(u.name)
                assert is_binary(u.email)
              end)
            end
            :timer.sleep(5)
          end
          :readers_completed
        end)

      # Wait for all workers to finish their churn loop
      for i <- 1..num_clients do
        assert_receive {:worker_done, ^i, _remaining_joined}, 10_000
      end

      assert Task.await(reader_task, 5_000) == :readers_completed

      # Allow 150ms for CRDT delta gossip & semilattice convergence
      Process.sleep(150)

      # Verify list_online/1 accuracy against ground truth oracle
      for topic <- all_topics do
        online = PresenceTracker.list_online(topic)
        online_uids = MapSet.new(Enum.map(online, & &1.uid))

        # Expected uids from oracle
        expected_uids =
          :ets.tab2list(oracle_table)
          |> Enum.filter(fn {{_uid, t}, status} -> t == topic and status == :joined end)
          |> Enum.map(fn {{uid, _t}, _status} -> uid end)
          |> MapSet.new()

        assert MapSet.equal?(online_uids, expected_uids),
               "Presence mismatch for #{topic}! Expected #{inspect(expected_uids)}, got #{inspect(online_uids)}"
      end

      # Cleanup workers
      Enum.each(workers, fn pid -> send(pid, :terminate) end)
      Process.sleep(150)

      # Verify all topics cleanly empty after worker termination
      for topic <- all_topics do
        assert PresenceTracker.list_online(topic) == [],
               "Topic #{topic} did not clean up after worker termination!"
      end

      :ets.delete(oracle_table)
    end

    test "Multi-session presence: user online across multiple PIDs in same room" do
      topic = ChatChannel.chat_topic("multi-session-room")
      user_id = "user-multi-device"

      # Session 1 (e.g. Desktop)
      pid1 = spawn(fn ->
        PresenceTracker.track(self(), topic, user_id, %{name: "Alice Desktop", email: "alice@test.com"})
        receive do :stop -> :ok end
      end)

      # Session 2 (e.g. Mobile)
      pid2 = spawn(fn ->
        PresenceTracker.track(self(), topic, user_id, %{name: "Alice Mobile", email: "alice@test.com"})
        receive do :stop -> :ok end
      end)

      # Session 3 (e.g. Web Tab)
      pid3 = spawn(fn ->
        PresenceTracker.track(self(), topic, user_id, %{name: "Alice Web", email: "alice@test.com"})
        receive do :stop -> :ok end
      end)

      Process.sleep(60)
      online = PresenceTracker.list_online(topic)
      # Phoenix.Tracker tracks all 3 tokens
      assert length(online) == 3
      assert Enum.all?(online, &(&1.uid == user_id))

      # Terminate Session 1
      send(pid1, :stop)
      Process.sleep(60)
      online_after_1 = PresenceTracker.list_online(topic)
      assert length(online_after_1) == 2
      assert Enum.all?(online_after_1, &(&1.uid == user_id))

      # Terminate Session 2
      send(pid2, :stop)
      Process.sleep(60)
      online_after_2 = PresenceTracker.list_online(topic)
      assert length(online_after_2) == 1
      assert hd(online_after_2).uid == user_id

      # Terminate Session 3
      send(pid3, :stop)
      Process.sleep(60)
      online_after_3 = PresenceTracker.list_online(topic)
      assert online_after_3 == []
    end

    test "Behavior of duplicate track on same PID and idempotency of untrack" do
      topic = ChatChannel.workspace_topic("idempotency-test")
      user_id = "user-rapid-idempotent"

      # Untracking non-tracked user should safely return :ok without crashing
      assert :ok = PresenceTracker.untrack(self(), topic, user_id)

      # First track call succeeds
      assert {:ok, _} = PresenceTracker.track(self(), topic, user_id, %{name: "Idem", email: "idem@test.com"})

      # Subsequent track on the same PID and topic returns {:error, {:already_tracked, ...}}
      assert {:error, {:already_tracked, _, ^topic, ^user_id}} =
               PresenceTracker.track(self(), topic, user_id, %{name: "Idem2", email: "idem2@test.com"})

      Process.sleep(50)
      online = PresenceTracker.list_online(topic)
      assert length(online) == 1
      assert hd(online).uid == user_id

      # Untrack removes the presence
      assert :ok = PresenceTracker.untrack(self(), topic, user_id)
      Process.sleep(50)
      assert PresenceTracker.list_online(topic) == []

      # Second untrack is idempotent (:ok)
      assert :ok = PresenceTracker.untrack(self(), topic, user_id)
    end
  end
end
