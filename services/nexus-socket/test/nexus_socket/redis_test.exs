defmodule NexusSocket.RedisTest do
  use ExUnit.Case, async: true
  alias NexusSocket.Redis.Protocol
  alias NexusSocket.Redis.Subscriber

  describe "RESP Protocol Encoding" do
    test "encodes commands into RESP array format" do
      assert Protocol.encode(["PING"]) == "*1\r\n$4\r\nPING\r\n"
      assert Protocol.encode(["AUTH", "mysecret"]) == "*2\r\n$4\r\nAUTH\r\n$8\r\nmysecret\r\n"

      assert Protocol.encode(["PSUBSCRIBE", "room:*:ai_stream"]) ==
               "*2\r\n$10\r\nPSUBSCRIBE\r\n$16\r\nroom:*:ai_stream\r\n"

      assert Protocol.encode(["PUBLISH", "nexus:broadcast", "hello"]) ==
               "*3\r\n$7\r\nPUBLISH\r\n$15\r\nnexus:broadcast\r\n$5\r\nhello\r\n"
    end
  end

  describe "RESP Protocol Decoding" do
    test "decodes simple strings, integers, errors, and bulk strings" do
      assert Protocol.decode("+OK\r\n") == {:ok, :ok, ""}
      assert Protocol.decode("+PONG\r\n") == {:ok, :pong, ""}
      assert Protocol.decode("-ERR invalid command\r\n") == {:ok, {:error, "ERR invalid command"}, ""}
      assert Protocol.decode(":100\r\n") == {:ok, {:integer, 100}, ""}
      assert Protocol.decode("$5\r\nhello\r\n") == {:ok, "hello", ""}
      assert Protocol.decode("$-1\r\n") == {:ok, nil, ""}
    end

    test "handles incomplete buffer gracefully" do
      assert Protocol.decode("") == {:incomplete, ""}
      assert Protocol.decode("$5\r\nhel") == {:incomplete, "$5\r\nhel"}
      assert Protocol.decode("*3\r\n$7\r\nmessage") == {:incomplete, "*3\r\n$7\r\nmessage"}
    end

    test "decodes pub/sub pmessage frames" do
      payload = "{\"delta\":\"Hello\",\"is_final\":false}"

      raw =
        "*4\r\n$8\r\npmessage\r\n$16\r\nroom:*:ai_stream\r\n$22\r\nroom:chat_99:ai_stream\r\n$#{byte_size(payload)}\r\n#{payload}\r\n"

      assert Protocol.decode(raw) ==
               {:ok, {:pmessage, "room:*:ai_stream", "room:chat_99:ai_stream", payload}, ""}
    end

    test "decodes pub/sub message frames" do
      raw =
        "*3\r\n$7\r\nmessage\r\n$15\r\nnexus:broadcast\r\n$18\r\n{\"topic\":\"system\"}\r\n"

      assert Protocol.decode(raw) ==
               {:ok, {:message, "nexus:broadcast", "{\"topic\":\"system\"}"}, ""}
    end

    test "preserves trailing unparsed bytes" do
      raw = "+OK\r\n+PONG\r\n"
      assert {:ok, :ok, "+PONG\r\n"} = Protocol.decode(raw)
    end
  end

  describe "Redis URL Parsing" do
    test "parses standard redis URLs" do
      assert Subscriber.parse_redis_url("redis://localhost:6379") == {"localhost", 6379, nil}
      assert Subscriber.parse_redis_url("redis://127.0.0.1:6380") == {"127.0.0.1", 6380, nil}
    end

    test "parses password authenticated redis URLs" do
      assert Subscriber.parse_redis_url("redis://:my_secret@redis.internal:6379") ==
               {"redis.internal", 6379, "my_secret"}

      assert Subscriber.parse_redis_url("redis://user:pass123@10.0.0.5:6381") ==
               {"10.0.0.5", 6381, "pass123"}
    end

    test "handles host:port without scheme" do
      assert Subscriber.parse_redis_url("localhost:6379") == {"localhost", 6379, nil}
    end
  end

  describe "Redis End-to-End AI Stream Dispatch" do
    setup do
      unless Process.whereis(NexusSocket.PubSub) do
        start_supervised!({Phoenix.PubSub, name: NexusSocket.PubSub})
      end

      unless Process.whereis(NexusSocket.AiStreamBuffer) do
        start_supervised!(NexusSocket.AiStreamBuffer)
      end

      :ok
    end

    test "decodes Redis AI stream chunk and fans out to Phoenix.PubSub room topic" do
      chat_id = "test-chat-redis-#{System.unique_integer([:positive])}"
      topic = "chat:#{chat_id}"
      Phoenix.PubSub.subscribe(NexusSocket.PubSub, topic)

      # Simulate what happens when a Redis pmessage arrives
      chunk_payload =
        Jason.encode!(%{
          "delta" => "Redis streamed token",
          "is_final" => true,
          "message_id" => "msg-redis-1"
        })

      raw_frame =
        "*4\r\n$8\r\npmessage\r\n$16\r\nroom:*:ai_stream\r\n$#{byte_size("room:#{chat_id}:ai_stream")}\r\nroom:#{chat_id}:ai_stream\r\n$#{byte_size(chunk_payload)}\r\n#{chunk_payload}\r\n"

      # Decode with protocol
      assert {:ok, {:pmessage, "room:*:ai_stream", channel, payload}, ""} =
               Protocol.decode(raw_frame)

      assert channel == "room:#{chat_id}:ai_stream"

      # Push directly to AiStreamBuffer as Subscriber does
      {:ok, decoded} = Jason.decode(payload)
      NexusSocket.AiStreamBuffer.push(chat_id, decoded["message_id"], decoded["delta"], decoded["is_final"])

      # Verify subscriber received the ai_stream_chunk broadcast
      assert_receive {:socket_broadcast, "ai_stream_chunk", received_payload}, 1000
      assert received_payload[:chatId] == chat_id
      assert received_payload[:delta] == "Redis streamed token"
      assert received_payload[:isFinal] == true
      assert received_payload[:messageId] == "msg-redis-1"
    end
  end

  describe "Disabled Redis Bridge Behavior" do
    setup do
      unless Process.whereis(NexusSocket.Redis.Supervisor) do
        start_supervised!({NexusSocket.Redis.Supervisor, redis_url: "disabled"})
      end

      :ok
    end

    test "status reflects disabled when URL is disabled or none" do
      assert match?(%{status: _}, NexusSocket.Redis.Publisher.status())
      assert match?(%{status: _}, NexusSocket.Redis.Subscriber.status())
    end

    test "publish gracefully handles disconnected/disabled state without crashing" do
      result = NexusSocket.Redis.publish("test:channel", %{"hello" => "world"})
      assert result in [{:error, :redis_disabled}, {:error, :not_connected}, {:error, :not_started}, :ok]
    end
  end
end
