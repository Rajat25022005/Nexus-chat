defmodule NexusSocket.ChallengerStressTest do
  use ExUnit.Case, async: false

  alias NexusSocket.Protocol.EngineIO
  alias NexusSocket.Protocol.SocketIO
  alias NexusSocket.Auth.Jwt
  alias NexusSocket.Auth.Cache
  alias NexusSocket.AiStreamBuffer
  alias NexusSocket.Transport.WebSocketHandler
  alias NexusSocket.Channels.ChannelHandler

  setup do
    Cache.clear()
    :ok
  end

  # =========================================================================
  # 1. MALFORMED PACKETS STRESS TESTS
  # =========================================================================
  describe "Adversarial Stress Test: Malformed Packets & Corrupted Payloads" do
    test "EngineIO handles truncated packets without crashing" do
      truncated_packets = [
        "",
        "0",
        "0{",
        "0{\"sid\":",
        "0{\"sid\":\"abc\"",
        "4"
      ]

      for pkt <- truncated_packets do
        case pkt do
          "" ->
            assert {:error, :empty_packet} = EngineIO.decode(pkt)
          "4" ->
            # Message frame with empty body
            assert {:ok, {:message, ""}} = EngineIO.decode(pkt)
          "0" ->
            assert {:error, {:invalid_json, _}} = EngineIO.decode(pkt)
          _ ->
            assert {:error, {:invalid_json, _}} = EngineIO.decode(pkt)
        end
      end
    end

    test "SocketIO handles truncated packets and returns clean errors" do
      truncated = [
        "",
        "0{",
        "0{\"token\":",
        "2",
        "2[",
        "2[\"event\"",
        "2[\"event\",",
        "2[\"event\", {",
        "3",
        "342",
        "342[",
        "4{"
      ]

      for pkt <- truncated do
        case pkt do
          "" ->
            assert {:error, :empty_packet} = SocketIO.decode(pkt)

          "2" ->
            # Event with empty payload -> data: nil
            assert {:ok, %SocketIO{type: :event, data: nil}} = SocketIO.decode(pkt)

          "3" ->
            # Ack with empty payload -> data: nil
            assert {:ok, %SocketIO{type: :ack, data: nil}} = SocketIO.decode(pkt)

          "342" ->
            # Ack with ID 42 but empty payload -> data: nil
            assert {:ok, %SocketIO{type: :ack, id: 42, data: nil}} = SocketIO.decode(pkt)

          _ ->
            assert {:error, {:invalid_json, _}} = SocketIO.decode(pkt)
        end
      end
    end

    test "SocketIO rejects corrupted and invalid JSON payloads" do
      corrupted_packets = [
        ~s(2["event", {unquoted_key: 123}]),
        ~s(2["event", NaN]),
        ~s(2["event", Infinity]),
        ~s(2["event", undefined]),
        ~s(2["event", {"unclosed": "brace"]),
        ~s(2["event", ]]),
        ~s(4{"message": unquoted}),
        ~s(0{token: "raw"})
      ]

      for pkt <- corrupted_packets do
        assert {:error, {:invalid_json, _}} = SocketIO.decode(pkt),
               "Expected invalid_json for: #{inspect(pkt)}"
      end
    end

    test "SocketIO rejects non-array EVENT payloads strictly" do
      non_array_event_payloads = [
        "2{}",
        "2\"just_a_string\"",
        "2true",
        "2false",
        "2null",
        "2{\"event\":\"foo\",\"data\":{}}"
      ]

      for pkt <- non_array_event_payloads do
        assert {:error, :event_payload_must_be_array} = SocketIO.decode(pkt),
               "Failed to reject non-array payload: #{inspect(pkt)}"
      end
    end

    test "SocketIO rejects empty or improperly typed event arrays" do
      # Empty array
      assert {:error, :empty_event_array} = SocketIO.decode("2[]")

      # First element not a string event name
      assert {:error, :invalid_event_format} = SocketIO.decode("2[123]")
      assert {:error, :invalid_event_format} = SocketIO.decode("2[null]")
      assert {:error, :invalid_event_format} = SocketIO.decode("2[true, {}]")
      assert {:error, :invalid_event_format} = SocketIO.decode("2[{}, {}]")
      assert {:error, :invalid_event_format} = SocketIO.decode("2[[], {}]")
    end

    test "Protocol parsers reject invalid packet types and arbitrary binary noise" do
      invalid_types = ["7", "8", "9", "x", "!", "-1", "999"]

      for t <- invalid_types do
        assert {:error, :unknown_engine_io_packet} = EngineIO.decode(t)
        assert {:error, :invalid_packet_type} = SocketIO.decode(t)
      end

      # Arbitrary binary noise
      noise = <<0, 1, 2, 255, 254, 253, 0, 0>>
      assert {:error, :unknown_engine_io_packet} = EngineIO.decode(noise)
      assert {:error, :invalid_packet_type} = SocketIO.decode(noise)
    end

    test "WebSocketHandler survives barrage of malformed EngineIO and SocketIO frames without crashing" do
      {:push, {:text, _open}, state} = WebSocketHandler.init([])

      adversarial_frames = [
        "",
        "x",
        "9999",
        "0",
        "0{",
        "4",
        "4x",
        "49",
        "42",
        "42[",
        "42[\"bad_json\", {",
        "42{}",
        "42\"string\"",
        "42[]",
        "42[123]",
        "43",
        "4342",
        "4342[",
        "44{",
        <<0, 255, 128>>,
        "42[\"send_message\", null]",
        "42[\"send_message\", \"not_a_map\"]"
      ]

      # Send all adversarial frames sequentially
      final_state =
        Enum.reduce(adversarial_frames, state, fn frame, curr_state ->
          res = WebSocketHandler.handle_in({frame, opcode: :text}, curr_state)
          case res do
            {:ok, new_state} -> new_state
            {:push, _reply, new_state} -> new_state
            {:stop, _reason, new_state} -> new_state
            {:stop, _reason, _close, _frames, new_state} -> new_state
          end
        end)

      assert is_map(final_state)
      assert final_state.sid != nil
    end

    test "ChannelHandler handles malformed event payloads safely without crashing" do
      user = %{user_id: "u-stress", email: "stress@test.com", name: "Stress Tester"}
      state = %{joined_rooms: MapSet.new()}

      malformed_payloads = [
        nil,
        "raw_string",
        12345,
        [1, 2, 3],
        %{},
        %{"chatId" => nil},
        %{"chatId" => ""},
        %{"chatId" => "c1", "content" => ""},
        %{"chatId" => "c1", "content" => nil},
        %{"chatId" => "c1", "content" => 12345},
        %{"messageId" => nil, "chatId" => nil},
        %{"emoji" => nil}
      ]

      events = [
        "join_chat",
        "leave_chat",
        "send_message",
        "edit_message",
        "delete_message",
        "react_message",
        "send_thread_reply",
        "typing_start",
        "typing_stop",
        "unknown_event_type"
      ]

      for event <- events, payload <- malformed_payloads do
        res = ChannelHandler.handle_event(event, payload, user, state)
        assert match?({:noreply, _}, res) or match?({:reply, _, _}, res),
               "ChannelHandler crashed on #{event} with #{inspect(payload)}"
      end
    end

    test "QUAL-01 REMEDIATION: ChannelHandler safely rejects nil or non-binary content without crashing" do
      user = %{user_id: "u-stress", email: "stress@test.com", name: "Stress Tester"}
      state = %{joined_rooms: MapSet.new()}

      # 1. send_message with explicit nil content
      assert {:reply, %{"success" => false, "error" => err1}, _} =
               ChannelHandler.handle_event("send_message", %{"chatId" => "c1", "content" => nil}, user, state)
      assert String.contains?(err1, "required")

      # 2. send_message with non-binary content (integer)
      assert {:reply, %{"success" => false, "error" => err2}, _} =
               ChannelHandler.handle_event("send_message", %{"chatId" => "c1", "content" => 123}, user, state)
      assert String.contains?(err2, "required")

      # 3. edit_message with explicit nil content
      assert {:reply, %{"success" => false, "error" => err3}, _} =
               ChannelHandler.handle_event("edit_message", %{"chatId" => "c1", "messageId" => "m1", "content" => nil}, user, state)
      assert String.contains?(err3, "required")

      # 4. send_thread_reply with explicit nil content
      assert {:reply, %{"success" => false, "error" => err4}, _} =
               ChannelHandler.handle_event("send_thread_reply", %{"parentMessageId" => "p1", "chatId" => "c1", "content" => nil}, user, state)
      assert String.contains?(err4, "required")
    end

    test "SEC-01 & SEC-02: ChannelHandler rejects unauthorized edit_message and delete_message attempts" do
      user_alice = %{user_id: "u-alice", email: "alice@test.com", name: "Alice"}
      state = %{joined_rooms: MapSet.new()}

      # Alice attempts to edit Bob's message
      unauth_edit = %{"chatId" => "c1", "messageId" => "m1", "content" => "tampered", "userId" => "u-bob"}
      assert {:reply, %{"success" => false, "error" => err_edit}, _} =
               ChannelHandler.handle_event("edit_message", unauth_edit, user_alice, state)
      assert String.contains?(err_edit, "Unauthorized")

      # Alice attempts to delete Bob's message
      unauth_del = %{"chatId" => "c1", "messageId" => "m1", "authorId" => "u-bob"}
      assert {:reply, %{"success" => false, "error" => err_del}, _} =
               ChannelHandler.handle_event("delete_message", unauth_del, user_alice, state)
      assert String.contains?(err_del, "Unauthorized")
    end
  end

  # =========================================================================
  # 2. ACK ID VARIATIONS STRESS TESTS
  # =========================================================================
  describe "Adversarial Stress Test: Ack ID Variations & Boundary Values" do
    test "Extracts Ack ID 0 correctly without confusing with nil" do
      raw = ~s(20["send_message",{"chatId":"c1","content":"hello"}])
      assert {:ok, packet} = SocketIO.decode(raw)
      assert packet.id == 0
      assert packet.type == :event

      # Encodes back preserving Ack ID 0
      assert {:ok, encoded} = SocketIO.encode(packet)
      assert String.starts_with?(encoded, "20[")
    end

    test "Handles large numeric IDs (64-bit and 128-bit large ints)" do
      # 64-bit max int: 18446744073709551615
      id_64 = 18_446_744_073_709_551_615
      raw_64 = "2#{id_64}[\"test_event\",{}]"
      assert {:ok, packet_64} = SocketIO.decode(raw_64)
      assert packet_64.id == id_64

      assert {:ok, encoded_64} = SocketIO.encode(packet_64)
      assert String.starts_with?(encoded_64, "218446744073709551615[")

      # 128-bit large int
      id_128 = 340_282_366_920_938_463_463_374_607_431_768_211_455
      raw_128 = "3#{id_128}[{\"ok\":true}]"
      assert {:ok, packet_128} = SocketIO.decode(raw_128)
      assert packet_128.id == id_128
      assert packet_128.type == :ack
    end

    test "Padded string Ack IDs are parsed numerically" do
      # "007" parses as integer 7
      raw = ~s(2007["event",{}])
      assert {:ok, packet} = SocketIO.decode(raw)
      assert packet.id == 7
      assert packet.data == ["event", %{}]
    end

    test "Non-numeric characters in ack position fall through to payload safely" do
      # "2-5" -> '-' is not a digit, so id is nil, remainder "-5[\"e\"]" fails json
      assert {:error, {:invalid_json, _}} = SocketIO.decode("2-5[\"event\",{}]")

      # "2abc" -> id is nil, remainder "abc..." fails json
      assert {:error, {:invalid_json, _}} = SocketIO.decode("2abc[\"event\",{}]")
    end

    test "WebSocketHandler emits ack reply with matching ack ID (including 0)" do
      {:push, {:text, _open}, state} = WebSocketHandler.init([])

      # Authenticate state first
      {:ok, token} = Jwt.sign(%{"user_id" => "u-ack", "email" => "ack@test.com"}, 3600)
      connect_frame = "40" <> Jason.encode!(%{"token" => token})
      {:push, {:text, "40" <> _}, conn_state} = WebSocketHandler.handle_in({connect_frame, opcode: :text}, state)
      assert conn_state.status == :connected

      # Join chat first
      join_frame = ~s(42["join_chat",{"chatId":"c-ack"}])
      {:ok, joined_state} = WebSocketHandler.handle_in({join_frame, opcode: :text}, conn_state)

      # Send message with ack ID 0
      send_msg_0 = ~s(420["send_message",{"chatId":"c-ack","content":"zero ack"}])
      assert {:push, {:text, ack_0}, _} = WebSocketHandler.handle_in({send_msg_0, opcode: :text}, joined_state)
      assert String.starts_with?(ack_0, "430[")
      assert ack_0 =~ ~s("success":true)

      # Send message with large ack ID 9876543210
      send_msg_large = ~s(429876543210["send_message",{"chatId":"c-ack","content":"large ack"}])
      assert {:push, {:text, ack_large}, _} = WebSocketHandler.handle_in({send_msg_large, opcode: :text}, joined_state)
      assert String.starts_with?(ack_large, "439876543210[")
      assert ack_large =~ ~s("success":true)

      # Send message with missing ack ID -> No push response (returns {:ok, state})
      send_msg_no_ack = ~s(42["send_message",{"chatId":"c-ack","content":"no ack"}])
      assert {:ok, _} = WebSocketHandler.handle_in({send_msg_no_ack, opcode: :text}, joined_state)
    end
  end

  # =========================================================================
  # 3. HIGH-THROUGHPUT AI TOKEN STREAMING STRESS TESTS
  # =========================================================================
  describe "Adversarial Stress Test: High-Throughput AI Stream Micro-Batching" do
    test "Rapid burst of 150+ small chunks coalesces into micro-batches without data loss" do
      chat_id = "ai-burst-chat-150"
      message_id = "ai-msg-150"
      topic = "chat:#{chat_id}"
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, topic)

      total_chunks = 150
      tokens = for i <- 1..total_chunks, do: "tok#{i} "
      expected_full_text = Enum.join(tokens)

      # Rapid unthrottled burst of 150 chunks
      Enum.each(Enum.with_index(tokens, 1), fn {tok, idx} ->
        is_final = idx == total_chunks
        AiStreamBuffer.push(chat_id, message_id, tok, is_final)
      end)

      # Drain all published chunks from PubSub mailbox
      received_chunks = drain_ai_chunks(chat_id, message_id, [])

      # 1. Verification: At least some coalescing occurred (batches < total_chunks)
      chunk_count = length(received_chunks)
      assert chunk_count < total_chunks,
             "Micro-batching failed: Received #{chunk_count} chunks for #{total_chunks} tokens!"

      # 2. Verification: Concatenated delta must match expected full text exactly
      reconstructed_text = Enum.map_join(received_chunks, & &1[:delta])
      assert reconstructed_text == expected_full_text,
             "Data corruption or loss detected in reconstructed stream!"

      # 3. Verification: Only the last chunk has isFinal: true
      {last_chunk, intermediate_chunks} = List.pop_at(received_chunks, -1)
      assert last_chunk[:isFinal] == true, "Last chunk must have isFinal: true"
      for chunk <- intermediate_chunks do
        assert chunk[:isFinal] == false, "Intermediate chunk had unexpected isFinal: true"
      end

      # 4. Verification: Buffer state is completely cleaned up (zero leak)
      assert AiStreamBuffer.active_streams_count() == 0,
             "Active stream buffer leaked in AiStreamBuffer state!"
    end

    test "Concurrent multi-client AI streaming stress (10 streams x 100 chunks = 1,000 chunks)" do
      num_streams = 10
      chunks_per_stream = 100

      # Subscribe to all 10 chat topics
      for s <- 1..num_streams do
        Phoenix.PubSub.subscribe(NexusSocket.PubSub, "chat:multi-#{s}")
      end

      # Launch 10 concurrent streams in parallel tasks
      tasks =
        for s <- 1..num_streams do
          Task.async(fn ->
            chat_id = "multi-#{s}"
            msg_id = "msg-#{s}"

            tokens = for i <- 1..chunks_per_stream, do: "s#{s}_t#{i} "

            Enum.each(Enum.with_index(tokens, 1), fn {tok, idx} ->
              is_final = idx == chunks_per_stream
              AiStreamBuffer.push(chat_id, msg_id, tok, is_final)
            end)

            {chat_id, msg_id, Enum.join(tokens)}
          end)
        end

      expected_streams = Task.await_many(tasks)

      # Collect and verify every stream
      for {chat_id, msg_id, expected_text} <- expected_streams do
        received = drain_ai_chunks(chat_id, msg_id, [])
        reconstructed = Enum.map_join(received, & &1[:delta])

        assert reconstructed == expected_text,
               "Stream #{chat_id} had data loss or corruption under concurrent load!"

        assert List.last(received)[:isFinal] == true
      end

      # Confirm zero remaining buffers
      assert AiStreamBuffer.active_streams_count() == 0
    end

    test "AI Stream Buffer edge cases: empty strings, manual flush, and unknown buffers" do
      chat_id = "ai-edge"
      msg_id = "msg-edge"
      topic = "chat:#{chat_id}"
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, topic)

      # Calling flush on non-existent buffer is a safe no-op
      assert :ok = AiStreamBuffer.flush("non-existent", "non-existent")

      # Push empty string
      AiStreamBuffer.push(chat_id, msg_id, "", false)
      AiStreamBuffer.flush(chat_id, msg_id)

      # Final empty chunk
      AiStreamBuffer.push(chat_id, msg_id, "", true)
      assert_receive {:socket_broadcast, "ai_stream_chunk", chunk}, 100
      assert chunk[:isFinal] == true
      assert chunk[:delta] == ""

      assert AiStreamBuffer.active_streams_count() == 0
    end
  end

  # =========================================================================
  # 4. TOKEN AUTHENTICATION EDGE CASES
  # =========================================================================
  describe "Adversarial Stress Test: JWT Authentication Edge Cases & Header Tampering" do
    test "Rejects expired tokens across multiple time horizons" do
      now = System.system_time(:second)

      horizons = [
        -1,     # Expired 1s ago
        -10,    # Expired 10s ago
        -3600,  # Expired 1h ago
        -86400  # Expired 1d ago
      ]

      for offset <- horizons do
        claims = %{"user_id" => "u-exp", "email" => "exp@test.com", "exp" => now + offset}
        {:ok, token} = Jwt.sign(claims, offset)

        assert {:error, :token_expired} = Jwt.verify(token)
        assert {:error, :token_expired} = Cache.authenticate(token)
      end

      # Exactly at current second boundary
      claims_now = %{"user_id" => "u-now", "email" => "now@test.com", "exp" => now}
      signer = Joken.Signer.create("HS256", Jwt.secret())
      {:ok, token_boundary} = Joken.Signer.sign(claims_now, signer)
      assert {:error, :token_expired} = Jwt.verify(token_boundary)
    end

    test "Rejects signature tampering and algorithm confusion (alg: none)" do
      claims = %{"user_id" => "u-tamper", "email" => "tamper@test.com"}
      {:ok, valid_token} = Jwt.sign(claims, 3600)

      # 1. Modify last character of signature
      [h, p, s] = String.split(valid_token, ".")
      corrupted_sig = s <> "x"
      tampered_token = "#{h}.#{p}.#{corrupted_sig}"
      assert {:error, _} = Jwt.verify(tampered_token)
      assert {:error, _} = Cache.authenticate(tampered_token)

      # 2. Truncated signature
      truncated_sig = "#{h}.#{p}."
      assert {:error, _} = Jwt.verify(truncated_sig)

      # 3. Algorithm substitution: alg = none
      alg_none_header = Base.url_encode64(~s({"alg":"none","typ":"JWT"}), padding: false)
      alg_none_token = "#{alg_none_header}.#{p}."
      assert {:error, _} = Jwt.verify(alg_none_token)

      # 4. Signed with wrong secret
      wrong_signer = Joken.Signer.create("HS256", "completely-wrong-secret-key-123456")
      {:ok, wrong_secret_token} = Joken.Signer.sign(claims, wrong_signer)
      assert {:error, _} = Jwt.verify(wrong_secret_token)
      assert {:error, _} = Cache.authenticate(wrong_secret_token)
    end

    test "Rejects malformed headers and token encodings" do
      malformed_tokens = [
        "",
        "   ",
        ".",
        "..",
        "...",
        "header.payload",
        "a.b.c.d.e",
        "!!!.@@@.###",
        nil,
        12345,
        %{}
      ]

      for tok <- malformed_tokens do
        assert {:error, _} = Jwt.verify(tok)
        assert {:error, _} = Cache.authenticate(tok)
      end
    end

    test "Rejects valid signatures with missing or corrupted claim schemas" do
      now = System.system_time(:second)

      invalid_claim_sets = [
        # Missing user_id
        %{"email" => "u@test.com", "exp" => now + 3600},
        # Missing email
        %{"user_id" => "u-1", "exp" => now + 3600},
        # Missing exp
        %{"user_id" => "u-1", "email" => "u@test.com"},
        # Empty string user_id
        %{"user_id" => "", "email" => "u@test.com", "exp" => now + 3600},
        # Empty string email
        %{"user_id" => "u-1", "email" => "", "exp" => now + 3600},
        # Non-string user_id
        %{"user_id" => 12345, "email" => "u@test.com", "exp" => now + 3600},
        # Non-string email
        %{"user_id" => "u-1", "email" => %{"address" => "u@test.com"}, "exp" => now + 3600},
        # Non-integer exp (string)
        %{"user_id" => "u-1", "email" => "u@test.com", "exp" => "3600"}
      ]

      signer = Joken.Signer.create("HS256", Jwt.secret())

      for claims <- invalid_claim_sets do
        {:ok, token} = Joken.Signer.sign(claims, signer)
        assert {:error, :missing_required_claims} = Jwt.verify(token),
               "Claims failed to be rejected: #{inspect(claims)}"
      end
    end

    test "WebSocket connect rejects empty, missing, or invalid token payloads gracefully" do
      {:push, {:text, _open}, state} = WebSocketHandler.init([])

      invalid_connect_payloads = [
        # Empty map
        "40{}",
        # Null token
        ~s(40{"token":null}),
        # Empty string token
        ~s(40{"token":""}),
        # Tampered token
        ~s(40{"token":"bad.jwt.token"}),
        # Non-map JSON payload
        "40\"raw_string\"",
        "40[1,2,3]",
        "40null"
      ]

      for payload <- invalid_connect_payloads do
        res = WebSocketHandler.handle_in({payload, opcode: :text}, state)
        assert {:stop, :normal, {1008, _reason}, [{:text, error_frame}], _state} = res
        assert String.starts_with?(error_frame, "44{")
      end
    end
  end

  # =========================================================================
  # 5. STATE LEAK & VM STABILITY INVARIANCE
  # =========================================================================
  describe "Adversarial Stress Test: State Leak & VM Stability Invariance" do
    test "ETS Cache does not leak memory or retain invalid/expired entries" do
      Cache.clear()
      assert Cache.count() == 0

      # Attempt 100 invalid authentications
      for i <- 1..100 do
        Cache.authenticate("malformed-token-#{i}")
      end

      # No invalid tokens should be stored in ETS
      assert Cache.count() == 0

      # Insert 50 short-lived tokens expiring in 1 second
      now = System.system_time(:second)
      for i <- 1..50 do
        Cache.put("temp-tok-#{i}", %{"user_id" => "u-#{i}", "email" => "u#{i}@test.com"}, now + 1)
      end

      assert Cache.count() == 50

      # Wait for expiration
      Process.sleep(1100)

      # Sweep
      evicted = Cache.sweep_expired()
      assert evicted == 50
      assert Cache.count() == 0
    end

    test "Supervision hierarchy remains healthy and stable after stress" do
      root_pid = Process.whereis(NexusSocket.Supervisor)
      assert Process.alive?(root_pid)

      # Check all supervised children
      children = Supervisor.which_children(NexusSocket.Supervisor)
      assert length(children) >= 5

      for {id, pid, type, _modules} <- children do
        assert is_pid(pid), "Supervised child #{inspect(id)} has invalid PID"
        assert Process.alive?(pid), "Supervised child #{inspect(id)} (type: #{type}) crashed!"
      end
    end
  end

  # =========================================================================
  # Helper Functions
  # =========================================================================
  defp drain_ai_chunks(chat_id, message_id, acc) do
    receive do
      {:socket_broadcast, "ai_stream_chunk", %{chatId: ^chat_id, messageId: ^message_id} = chunk} ->
        new_acc = acc ++ [chunk]
        if chunk[:isFinal] do
          new_acc
        else
          drain_ai_chunks(chat_id, message_id, new_acc)
        end
    after
      2000 ->
        flunk("Timed out waiting for AI stream chunks for #{chat_id} (collected #{length(acc)} chunks)")
    end
  end
end
