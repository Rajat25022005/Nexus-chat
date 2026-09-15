defmodule NexusSocket.StreamingTest do
  use ExUnit.Case, async: false
  alias NexusSocket.AiStreamBuffer

  describe "Soft Real-Time AI Token Streaming (F11)" do
    test "coalesces small tokens and flushes on timer expiration" do
      chat_id = "ai-chat-timer"
      message_id = "ai-msg-1"
      topic = "chat:#{chat_id}"
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, topic)

      # Push 3 small tokens (below threshold of 20 chars in test config)
      AiStreamBuffer.push(chat_id, message_id, "Hello", false)
      AiStreamBuffer.push(chat_id, message_id, " ", false)
      AiStreamBuffer.push(chat_id, message_id, "Nexus", false)

      # In test config, flush interval is 10ms
      assert_receive {:socket_broadcast, "ai_stream_chunk", chunk}, 100
      assert chunk[:chatId] == chat_id
      assert chunk[:messageId] == message_id
      assert chunk[:delta] == "Hello Nexus"
      assert chunk[:isFinal] == false
    end

    test "flushes immediately when accumulated buffer reaches max_buffer_chars" do
      chat_id = "ai-chat-size"
      message_id = "ai-msg-2"
      topic = "chat:#{chat_id}"
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, topic)

      # Test threshold is 20 chars; push 25 chars in one shot
      delta = "This string exceeds the twenty character limit!"
      AiStreamBuffer.push(chat_id, message_id, delta, false)

      # Should flush immediately without waiting for timer
      assert_receive {:socket_broadcast, "ai_stream_chunk", chunk}, 50
      assert chunk[:delta] == delta
      assert chunk[:isFinal] == false
    end

    test "flushes immediately and terminates buffer when is_final: true" do
      chat_id = "ai-chat-final"
      message_id = "ai-msg-3"
      topic = "chat:#{chat_id}"
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, topic)

      AiStreamBuffer.push(chat_id, message_id, "Final chunk.", true)

      assert_receive {:socket_broadcast, "ai_stream_chunk", chunk}, 50
      assert chunk[:delta] == "Final chunk."
      assert chunk[:isFinal] == true
    end

    test "isolates concurrent streams across different chats and messages" do
      chat_1 = "ai-c1"
      chat_2 = "ai-c2"
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, "chat:#{chat_1}")
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, "chat:#{chat_2}")

      AiStreamBuffer.push(chat_1, "m1", "Stream 1 Token", true)
      AiStreamBuffer.push(chat_2, "m2", "Stream 2 Token", true)

      assert_receive {:socket_broadcast, "ai_stream_chunk", chunk1}, 100
      assert_receive {:socket_broadcast, "ai_stream_chunk", chunk2}, 100

      assert {chunk1[:chatId], chunk1[:delta]} == {chat_1, "Stream 1 Token"}
      assert {chunk2[:chatId], chunk2[:delta]} == {chat_2, "Stream 2 Token"}
    end

    test "manual flush/2 forces immediate delivery of buffered tokens" do
      chat_id = "ai-chat-manual"
      message_id = "ai-msg-manual"
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, "chat:#{chat_id}")

      AiStreamBuffer.push(chat_id, message_id, "Buffered data", false)
      AiStreamBuffer.flush(chat_id, message_id)

      assert_receive {:socket_broadcast, "ai_stream_chunk", chunk}, 50
      assert chunk[:delta] == "Buffered data"
      assert chunk[:isFinal] == false
    end

    test "QUAL-04: prunes buffer from state after flush timeout so abandoned streams do not leak" do
      chat_id = "ai-abandoned"
      message_id = "ai-msg-abandoned"
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, "chat:#{chat_id}")

      # Push an incomplete stream chunk without is_final: true
      AiStreamBuffer.push(chat_id, message_id, "abandoned chunk", false)
      assert AiStreamBuffer.active_streams_count() >= 1

      # Wait for flush interval to expire (10ms in test config)
      assert_receive {:socket_broadcast, "ai_stream_chunk", _chunk}, 100

      # Wait a brief moment for the handle_info to delete the buffer
      Process.sleep(20)

      # Buffer must be pruned from state even though is_final was never sent
      assert AiStreamBuffer.active_streams_count() == 0
    end

    test "clear/0 clears all active stream buffers" do
      AiStreamBuffer.push("c1", "m1", "tok1", false)
      assert AiStreamBuffer.active_streams_count() >= 1
      assert :ok = AiStreamBuffer.clear()
      assert AiStreamBuffer.active_streams_count() == 0
    end
  end
end
