defmodule NexusSocket.CrashIsolationStressTest do
  use ExUnit.Case, async: false

  alias NexusSocket.Presence.Tracker, as: PresenceTracker
  alias NexusSocket.Channels.ChatChannel
  alias NexusSocket.Channels.ChannelHandler
  alias NexusSocket.Auth.Jwt
  alias NexusSocket.Auth.Cache

  import Bitwise

  @moduledoc """
  Empirical stress harness for OTP fault isolation and supervisor recovery.
  Injects unhandled throws, runtime exceptions, and SIGKILL-equivalent exits
  into connection processes to verify:
  1. Sibling connections remain completely unaffected
  2. Root supervisor and child supervisors recover cleanly without cascading restarts
  3. Disconnected and crashed users are untracked immediately from CRDT presence
  4. Real TCP WebSocket connections survive sibling connection drops and receive presence broadcasts
  """

  # --- Minimal RFC 6455 Client Helpers for Direct Bandit Integration ---

  defp connect_ws(port, token) do
    {:ok, sock} = :gen_tcp.connect(~c"127.0.0.1", port, [:binary, active: false])
    req =
      "GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\n" <>
      "Host: 127.0.0.1:#{port}\r\n" <>
      "Upgrade: websocket\r\n" <>
      "Connection: Upgrade\r\n" <>
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" <>
      "Sec-WebSocket-Version: 13\r\n\r\n"

    :gen_tcp.send(sock, req)
    {:ok, _handshake} = :gen_tcp.recv(sock, 0, 2000)
    _open = recv_ws_frame(sock)

    # Send connect packet 40{"token":"..."}
    send_ws_frame(sock, "40" <> Jason.encode!(%{"token" => token}))
    _ack = recv_ws_frame(sock)
    {:ok, sock}
  end

  defp send_ws_frame(sock, payload) do
    key = :crypto.strong_rand_bytes(4)
    masked =
      for {b, i} <- Enum.with_index(:binary.bin_to_list(payload)), into: <<>> do
        k = :binary.at(key, rem(i, 4))
        <<bxor(b, k)>>
      end

    len = byte_size(payload)
    len_bytes =
      cond do
        len < 126 -> <<1::1, len::7>>
        len < 65536 -> <<1::1, 126::7, len::16>>
        true -> <<1::1, 127::7, len::64>>
      end

    frame = <<1::1, 0::3, 1::4>> <> len_bytes <> key <> masked
    :gen_tcp.send(sock, frame)
  end

  defp recv_ws_frame(sock) do
    case :gen_tcp.recv(sock, 2, 2000) do
      {:ok, <<_fin::1, _rsv::3, _opcode::4, _mask::1, len::7>>} ->
        actual_len =
          cond do
            len < 126 -> len
            len == 126 ->
              {:ok, <<l::16>>} = :gen_tcp.recv(sock, 2, 2000)
              l
          end

        {:ok, payload} = :gen_tcp.recv(sock, actual_len, 2000)
        payload

      err ->
        err
    end
  end

  defp recv_matching_frame(sock, predicate, attempts \\ 10) do
    if attempts <= 0 do
      {:error, :timeout}
    else
      case recv_ws_frame(sock) do
        frame when is_binary(frame) ->
          if predicate.(frame) do
            {:ok, frame}
          else
            recv_matching_frame(sock, predicate, attempts - 1)
          end

        err ->
          err
      end
    end
  end

  setup do
    # Capture initial PIDs of all supervised infrastructure
    root_pid = Process.whereis(NexusSocket.Supervisor)
    tracker_pid = Process.whereis(NexusSocket.Presence.Tracker)
    cache_pid = Process.whereis(NexusSocket.Auth.Cache)
    pubsub_pid = Process.whereis(NexusSocket.PubSub)
    stream_pid = Process.whereis(NexusSocket.AiStreamBuffer)
    conn_sup_pid = Process.whereis(NexusSocket.ConnectionSupervisor)

    assert is_pid(root_pid) and Process.alive?(root_pid)
    assert is_pid(tracker_pid) and Process.alive?(tracker_pid)
    assert is_pid(cache_pid) and Process.alive?(cache_pid)
    assert is_pid(pubsub_pid) and Process.alive?(pubsub_pid)
    assert is_pid(stream_pid) and Process.alive?(stream_pid)
    assert is_pid(conn_sup_pid) and Process.alive?(conn_sup_pid)

    %{
      root_pid: root_pid,
      tracker_pid: tracker_pid,
      cache_pid: cache_pid,
      pubsub_pid: pubsub_pid,
      stream_pid: stream_pid,
      conn_sup_pid: conn_sup_pid
    }
  end

  describe "OTP Crash Isolation & Presence Untracking" do
    test "Scenario 1: Sibling isolation under injected unhandled throw(:unexpected_error)", ctx do
      chat_topic = ChatChannel.chat_topic("crash-room-throw")
      ws_topic = ChatChannel.workspace_topic("crash-ws-throw")

      parent = self()

      # Client A: Rogue process that will encounter an unhandled throw
      client_a =
        spawn(fn ->
          PresenceTracker.track(self(), chat_topic, "usr-rogue-throw", %{name: "Rogue Throw", email: "throw@test.com"})
          PresenceTracker.track(self(), ws_topic, "usr-rogue-throw", %{name: "Rogue Throw", email: "throw@test.com"})
          send(parent, {:client_a_ready, self()})

          receive do
            :inject_throw ->
              throw(:unhandled_socket_protocol_error)
          end
        end)

      # Client B: Sibling process that must remain completely unaffected
      client_b =
        spawn(fn ->
          PresenceTracker.track(self(), chat_topic, "usr-healthy-b", %{name: "Healthy B", email: "b@test.com"})
          send(parent, {:client_b_ready, self()})

          receive do
            {:ping, sender} ->
              send(sender, {:pong, self()})
            :stop ->
              :ok
          end
        end)

      assert_receive {:client_a_ready, ^client_a}, 1000
      assert_receive {:client_b_ready, ^client_b}, 1000

      Process.sleep(50)

      # Verify both users online in chat_topic and client_a online in ws_topic
      chat_online = PresenceTracker.list_online(chat_topic)
      assert length(chat_online) == 2
      assert Enum.any?(chat_online, &(&1.uid == "usr-rogue-throw"))
      assert Enum.any?(chat_online, &(&1.uid == "usr-healthy-b"))

      ws_online = PresenceTracker.list_online(ws_topic)
      assert length(ws_online) == 1
      assert hd(ws_online).uid == "usr-rogue-throw"

      # Monitor client_a to observe its crash
      ref_a = Process.monitor(client_a)

      # Inject unhandled throw into Client A
      send(client_a, :inject_throw)

      # Observe Client A crash
      assert_receive {:DOWN, ^ref_a, :process, ^client_a, {{:nocatch, :unhandled_socket_protocol_error}, _}}, 1000

      # Immediately verify presence reconciliation
      Process.sleep(50)

      # 1. Client A MUST be untracked from both chat and workspace topics
      chat_online_after = PresenceTracker.list_online(chat_topic)
      assert length(chat_online_after) == 1
      assert hd(chat_online_after).uid == "usr-healthy-b"

      ws_online_after = PresenceTracker.list_online(ws_topic)
      assert ws_online_after == []

      # 2. Sibling Client B MUST remain alive and responsive
      assert Process.alive?(client_b)
      send(client_b, {:ping, self()})
      assert_receive {:pong, ^client_b}, 500

      # 3. Supervision tree must not have restarted any core service
      assert Process.whereis(NexusSocket.Supervisor) == ctx.root_pid
      assert Process.whereis(NexusSocket.Presence.Tracker) == ctx.tracker_pid
      assert Process.whereis(NexusSocket.Auth.Cache) == ctx.cache_pid

      # Cleanup
      send(client_b, :stop)
    end

    test "Scenario 2: Sibling isolation under injected unhandled raise (RuntimeError)", ctx do
      chat_topic = ChatChannel.chat_topic("crash-room-raise")

      parent = self()

      client_c =
        spawn(fn ->
          PresenceTracker.track(self(), chat_topic, "usr-rogue-raise", %{name: "Rogue Raise", email: "raise@test.com"})
          send(parent, {:client_c_ready, self()})

          receive do
            :inject_raise ->
              raise RuntimeError, "Severe socket framing corruption"
          end
        end)

      client_d =
        spawn(fn ->
          PresenceTracker.track(self(), chat_topic, "usr-healthy-d", %{name: "Healthy D", email: "d@test.com"})
          send(parent, {:client_d_ready, self()})

          receive do
            {:query_status, sender} ->
              send(sender, {:status_ok, self()})
            :stop ->
              :ok
          end
        end)

      assert_receive {:client_c_ready, ^client_c}, 1000
      assert_receive {:client_d_ready, ^client_d}, 1000

      Process.sleep(50)
      assert length(PresenceTracker.list_online(chat_topic)) == 2

      ref_c = Process.monitor(client_c)
      send(client_c, :inject_raise)

      assert_receive {:DOWN, ^ref_c, :process, ^client_c, {%RuntimeError{message: "Severe socket framing corruption"}, _}}, 1000

      Process.sleep(50)

      # Verify presence untracked immediately
      online_after = PresenceTracker.list_online(chat_topic)
      assert length(online_after) == 1
      assert hd(online_after).uid == "usr-healthy-d"

      # Sibling D alive
      assert Process.alive?(client_d)
      send(client_d, {:query_status, self()})
      assert_receive {:status_ok, ^client_d}, 500

      # Core services intact
      assert Process.whereis(NexusSocket.Supervisor) == ctx.root_pid
      assert Process.whereis(NexusSocket.Presence.Tracker) == ctx.tracker_pid

      send(client_d, :stop)
    end

    test "Scenario 3: Brutal crash via Process.exit(:kill) bypassing terminate/2 callbacks", ctx do
      chat_topic = ChatChannel.chat_topic("crash-kill-room")
      ws_topic = ChatChannel.workspace_topic("crash-kill-ws")

      parent = self()

      client_e =
        spawn(fn ->
          PresenceTracker.track(self(), chat_topic, "usr-brutal-kill", %{name: "Brutal Kill", email: "kill@test.com"})
          PresenceTracker.track(self(), ws_topic, "usr-brutal-kill", %{name: "Brutal Kill", email: "kill@test.com"})
          send(parent, {:client_e_ready, self()})

          receive do
            :never_reached -> :ok
          end
        end)

      assert_receive {:client_e_ready, ^client_e}, 1000
      Process.sleep(50)

      assert length(PresenceTracker.list_online(chat_topic)) == 1
      assert length(PresenceTracker.list_online(ws_topic)) == 1

      # Send uncatchable :kill signal. Note: terminate/2 does NOT execute on :kill.
      # Presence cleanup relies entirely on Delta-CRDT process monitoring.
      ref_e = Process.monitor(client_e)
      Process.exit(client_e, :kill)

      assert_receive {:DOWN, ^ref_e, :process, ^client_e, :killed}, 1000

      Process.sleep(60)

      # Both rooms must be completely clean with ZERO orphaned entries
      assert PresenceTracker.list_online(chat_topic) == []
      assert PresenceTracker.list_online(ws_topic) == []

      assert Process.whereis(NexusSocket.Supervisor) == ctx.root_pid
    end

    test "Scenario 4: High-concurrency crash storm under PartitionSupervisor", ctx do
      chat_topic = ChatChannel.chat_topic("crash-storm-topic")
      ws_topic = ChatChannel.workspace_topic("crash-storm-ws")

      num_rogues = 40
      num_survivors = 10

      parent = self()

      # 1. Start 10 survivor processes under ConnectionSupervisor
      survivors =
        for s <- 1..num_survivors do
          uid = "survivor-#{s}"
          spec =
            {Task,
             fn ->
               PresenceTracker.track(self(), chat_topic, uid, %{name: "Survivor #{s}", email: "#{s}@surv.test"})
               PresenceTracker.track(self(), ws_topic, uid, %{name: "Survivor #{s}", email: "#{s}@surv.test"})
               send(parent, {:survivor_ready, s, self()})

               receive do
                 {:heartbeat, from} -> send(from, {:alive, s})
                 :shutdown -> :ok
               end
             end}

          {:ok, pid} =
            DynamicSupervisor.start_child(
              {:via, PartitionSupervisor, {NexusSocket.ConnectionSupervisor, uid}},
              spec
            )

          pid
        end

      # 2. Start 40 rogue processes under ConnectionSupervisor
      rogues =
        for r <- 1..num_rogues do
          uid = "rogue-#{r}"
          spec =
            {Task,
             fn ->
               PresenceTracker.track(self(), chat_topic, uid, %{name: "Rogue #{r}", email: "#{r}@rogue.test"})
               send(parent, {:rogue_ready, r, self()})

               receive do
                 :crash_now ->
                   case rem(r, 3) do
                     0 -> throw(:simulated_fatal_disconnect)
                     1 -> raise RuntimeError, "simulated parse failure"
                     2 -> exit(:simulated_process_exit)
                   end
               end
             end}

          {:ok, pid} =
            DynamicSupervisor.start_child(
              {:via, PartitionSupervisor, {NexusSocket.ConnectionSupervisor, uid}},
              spec
            )

          pid
        end

      # Wait for all processes to report ready
      for s <- 1..num_survivors do
        assert_receive {:survivor_ready, ^s, _pid}, 2000
      end

      for r <- 1..num_rogues do
        assert_receive {:rogue_ready, ^r, _pid}, 2000
      end

      Process.sleep(100)

      # 50 total users online in chat_topic
      assert length(PresenceTracker.list_online(chat_topic)) == num_rogues + num_survivors

      # 3. Trigger simultaneous crash across all 40 rogue processes
      Enum.each(rogues, fn pid ->
        send(pid, :crash_now)
      end)

      # Allow 150ms for CRDT convergence
      Process.sleep(150)

      # 4. Invariant checks:
      # A: Exactly the 10 survivor users remain online in chat_topic
      online_after_storm = PresenceTracker.list_online(chat_topic)
      assert length(online_after_storm) == num_survivors
      online_uids = Enum.map(online_after_storm, & &1.uid) |> MapSet.new()

      expected_survivors =
        for s <- 1..num_survivors, into: MapSet.new() do
          "survivor-#{s}"
        end

      assert MapSet.equal?(online_uids, expected_survivors),
             "Storm reconciliation error! Remaining: #{inspect(online_uids)}"

      # B: All 10 survivors are still responsive to messages
      Enum.each(survivors, fn pid ->
        assert Process.alive?(pid)
        send(pid, {:heartbeat, self()})
        assert_receive {:alive, _s_idx}, 500
      end)

      # C: Root supervisor and all core child services did NOT crash or restart
      assert Process.whereis(NexusSocket.Supervisor) == ctx.root_pid
      assert Process.whereis(NexusSocket.Presence.Tracker) == ctx.tracker_pid
      assert Process.whereis(NexusSocket.Auth.Cache) == ctx.cache_pid
      assert Process.whereis(NexusSocket.ConnectionSupervisor) == ctx.conn_sup_pid

      # Cleanup survivors
      Enum.each(survivors, fn pid -> send(pid, :shutdown) end)
      Process.sleep(50)
    end

    test "Scenario 5: ChannelHandler functional message delivery unaffected after connection crash", ctx do
      chat_id = "resilience-chat-99"
      chat_topic = ChatChannel.chat_topic(chat_id)

      {:ok, token_user1} = Jwt.sign(%{"user_id" => "usr-persist-1", "email" => "u1@resilience.test"}, 3600)
      {:ok, claims1} = Cache.authenticate(token_user1)
      user1 = %{user_id: claims1["user_id"], email: claims1["email"], name: "User 1"}

      parent = self()

      # Receiver process listening on PubSub
      receiver =
        spawn(fn ->
          Phoenix.PubSub.subscribe(NexusSocket.PubSub, chat_topic)
          send(parent, {:receiver_ready, self()})

          receive do
            {:socket_broadcast, "new_message", payload} ->
              send(parent, {:message_received, payload})
            :stop ->
              :ok
          end
        end)

      assert_receive {:receiver_ready, ^receiver}, 1000

      # A temporary client crashes while in the room
      crasher =
        spawn(fn ->
          PresenceTracker.track(self(), chat_topic, "usr-crash-temp", %{name: "Temp", email: "temp@test.com"})
          send(parent, {:crasher_ready, self()})
          receive do
            :die -> exit(:kill)
          end
        end)

      assert_receive {:crasher_ready, ^crasher}, 1000
      Process.sleep(50)

      # Kill crasher
      Process.exit(crasher, :kill)
      Process.sleep(50)

      # Ensure user1 can still dispatch messages through ChannelHandler cleanly
      state = %{joined_rooms: MapSet.new([chat_topic])}
      msg_payload = %{"chatId" => chat_id, "content" => "Post-crash operational verification"}

      assert {:reply, ack, _new_state} =
               ChannelHandler.handle_event("send_message", msg_payload, user1, state)

      assert ack["success"] == true

      # Receiver must receive the broadcast cleanly
      assert_receive {:message_received, received_payload}, 1000
      assert received_payload["content"] == "Post-crash operational verification"
      assert received_payload["userId"] == "usr-persist-1"

      send(receiver, :stop)
    end

    test "Scenario 6: Real TCP WebSocket connection abrupt drop & sibling continuity", ctx do
      port = Application.get_env(:nexus_socket, :port, 4002)

      {:ok, token_alice} = Jwt.sign(%{"user_id" => "usr-ws-alice", "email" => "alice@ws.test"}, 3600)
      {:ok, token_bob} = Jwt.sign(%{"user_id" => "usr-ws-bob", "email" => "bob@ws.test"}, 3600)

      chat_id = "ws-duo-chat"
      topic = ChatChannel.chat_topic(chat_id)

      # Connect Alice and Bob over real TCP WebSockets
      {:ok, sock_alice} = connect_ws(port, token_alice)
      {:ok, sock_bob} = connect_ws(port, token_bob)

      # Both join chat room
      send_ws_frame(sock_alice, "42" <> Jason.encode!(["join_chat", %{"chatId" => chat_id}]))
      send_ws_frame(sock_bob, "42" <> Jason.encode!(["join_chat", %{"chatId" => chat_id}]))

      Process.sleep(100)

      # Verify both online
      online = PresenceTracker.list_online(topic)
      assert length(online) == 2
      assert Enum.any?(online, &(&1.uid == "usr-ws-alice"))
      assert Enum.any?(online, &(&1.uid == "usr-ws-bob"))

      # Alice abruptly drops TCP connection
      :gen_tcp.close(sock_alice)

      # Allow 100ms for Bandit socket termination and Tracker reconciliation
      Process.sleep(100)

      # Alice untracked immediately, Bob remains online
      online_after = PresenceTracker.list_online(topic)
      assert length(online_after) == 1
      assert hd(online_after).uid == "usr-ws-bob"

      # Bob receives user_left event from Alice's departure
      assert {:ok, user_left_frame} =
               recv_matching_frame(sock_bob, fn frame ->
                 String.contains?(frame, "user_left") and String.contains?(frame, "usr-ws-alice")
               end)

      assert is_binary(user_left_frame)

      # Bob can still send a message with Ack ID 88
      send_msg_payload = "4288" <> Jason.encode!(["send_message", %{"chatId" => chat_id, "content" => "Bob is still here"}])
      send_ws_frame(sock_bob, send_msg_payload)

      # Bob receives Ack frame matching 4388
      assert {:ok, ack_frame} =
               recv_matching_frame(sock_bob, fn frame ->
                 String.starts_with?(frame, "4388")
               end)

      assert is_binary(ack_frame)

      # Core infrastructure survives
      assert Process.whereis(NexusSocket.Supervisor) == ctx.root_pid
      assert Process.whereis(NexusSocket.Presence.Tracker) == ctx.tracker_pid

      :gen_tcp.close(sock_bob)
      Process.sleep(50)
    end
  end
end
