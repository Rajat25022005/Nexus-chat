defmodule NexusSocket.SocketIoTest do
  use ExUnit.Case, async: true
  alias NexusSocket.Protocol.SocketIO

  describe "Socket.IO v4 Connect & Disconnect (F3)" do
    test "decodes default namespace CONNECT packet with token payload" do
      raw = ~s(0{"token":"jwt.sample.token"})
      assert {:ok, packet} = SocketIO.decode(raw)
      assert packet.type == :connect
      assert packet.nsp == "/"
      assert packet.id == nil
      assert packet.data == %{"token" => "jwt.sample.token"}
    end

    test "decodes CONNECT packet with no payload" do
      assert {:ok, packet} = SocketIO.decode("0")
      assert packet.type == :connect
      assert packet.nsp == "/"
      assert packet.id == nil
      assert packet.data == %{}
    end

    test "decodes custom namespace CONNECT packet" do
      raw = ~s(0/workspace,{"token":"abc"})
      assert {:ok, packet} = SocketIO.decode(raw)
      assert packet.type == :connect
      assert packet.nsp == "/workspace"
      assert packet.id == nil
      assert packet.data == %{"token" => "abc"}
    end

    test "encodes CONNECT packet" do
      packet = %SocketIO{type: :connect, nsp: "/", data: %{"sid" => "sess123"}}
      assert {:ok, encoded} = SocketIO.encode(packet)
      assert encoded == ~s(0{"sid":"sess123"})
    end

    test "decodes DISCONNECT packet" do
      assert {:ok, packet} = SocketIO.decode("1")
      assert packet.type == :disconnect
      assert packet.nsp == "/"
      assert packet.id == nil
      assert packet.data == nil
    end

    test "decodes custom namespace DISCONNECT packet" do
      assert {:ok, packet} = SocketIO.decode("1/admin,")
      assert packet.type == :disconnect
      assert packet.nsp == "/admin"
      assert packet.id == nil
    end

    test "encodes DISCONNECT packet" do
      assert {:ok, "1"} = SocketIO.encode(%SocketIO{type: :disconnect, nsp: "/"})
      assert {:ok, "1/admin,"} = SocketIO.encode(%SocketIO{type: :disconnect, nsp: "/admin"})
    end
  end

  describe "Socket.IO v4 Events & Acknowledgments (F3 / F8)" do
    test "decodes standard EVENT packet without ack" do
      raw = ~s(2["join_chat",{"chatId":"chat-1","groupId":"group-1"}])
      assert {:ok, packet} = SocketIO.decode(raw)
      assert packet.type == :event
      assert packet.nsp == "/"
      assert packet.id == nil
      assert [event_name, payload] = packet.data
      assert event_name == "join_chat"
      assert payload["chatId"] == "chat-1"
      assert payload["groupId"] == "group-1"
    end

    test "decodes EVENT packet with numeric Ack ID" do
      raw = ~s(242["send_message",{"content":"Hello World"}])
      assert {:ok, packet} = SocketIO.decode(raw)
      assert packet.type == :event
      assert packet.nsp == "/"
      assert packet.id == 42
      assert [event_name, payload] = packet.data
      assert event_name == "send_message"
      assert payload["content"] == "Hello World"
    end

    test "decodes EVENT packet with Ack ID 0 (boundary)" do
      raw = ~s(20["ping_event",{}])
      assert {:ok, packet} = SocketIO.decode(raw)
      assert packet.type == :event
      assert packet.id == 0
    end

    test "decodes EVENT packet with custom namespace and Ack ID" do
      raw = ~s(2/custom,105["custom_event",{"x":1}])
      assert {:ok, packet} = SocketIO.decode(raw)
      assert packet.type == :event
      assert packet.nsp == "/custom"
      assert packet.id == 105
      assert packet.data == ["custom_event", %{"x" => 1}]
    end

    test "encodes EVENT packet" do
      packet = %SocketIO{
        type: :event,
        nsp: "/",
        id: nil,
        data: ["new_message", %{"id" => "m-1", "content" => "hey"}]
      }

      assert {:ok, encoded} = SocketIO.encode(packet)
      assert encoded == ~s(2["new_message",{"content":"hey","id":"m-1"}])
    end

    test "decodes ACK packet with callback payload" do
      raw = ~s(342[{"status":"ok","messageId":"m-1"}])
      assert {:ok, packet} = SocketIO.decode(raw)
      assert packet.type == :ack
      assert packet.nsp == "/"
      assert packet.id == 42
      assert packet.data == [%{"status" => "ok", "messageId" => "m-1"}]
    end

    test "encodes ACK packet" do
      packet = %SocketIO{
        type: :ack,
        nsp: "/",
        id: 7,
        data: [%{"success" => true, "replyId" => "r-1"}]
      }

      assert {:ok, encoded} = SocketIO.encode(packet)
      assert encoded == ~s(37[{"replyId":"r-1","success":true}])
    end
  end

  describe "Socket.IO v4 Connect Error (F3)" do
    test "decodes CONNECT_ERROR packet" do
      raw = ~s(4{"message":"Invalid authentication token"})
      assert {:ok, packet} = SocketIO.decode(raw)
      assert packet.type == :connect_error
      assert packet.nsp == "/"
      assert packet.data == %{"message" => "Invalid authentication token"}
    end

    test "encodes CONNECT_ERROR packet" do
      packet = %SocketIO{
        type: :connect_error,
        nsp: "/",
        data: %{"message" => "Authentication required"}
      }

      assert {:ok, encoded} = SocketIO.encode(packet)
      assert encoded == ~s(4{"message":"Authentication required"})
    end
  end

  describe "Socket.IO v4 Edge Cases & Strict Validation" do
    test "rejects empty packet" do
      assert {:error, :empty_packet} = SocketIO.decode("")
    end

    test "rejects invalid packet type" do
      assert {:error, :invalid_packet_type} = SocketIO.decode("9[\"event\"]")
      assert {:error, :invalid_packet_type} = SocketIO.decode("x")
    end

    test "rejects non-array EVENT payload" do
      assert {:error, :event_payload_must_be_array} = SocketIO.decode("2\"just_a_string\"")
      assert {:error, :event_payload_must_be_array} = SocketIO.decode("2{\"not\":\"array\"}")
    end

    test "rejects empty EVENT array" do
      assert {:error, :empty_event_array} = SocketIO.decode("2[]")
    end

    test "rejects EVENT array where first element is not a string event name" do
      assert {:error, :invalid_event_format} = SocketIO.decode("2[123,{\"data\":1}]")
    end

    test "handles malformed JSON payload gracefully" do
      assert {:error, {:invalid_json, _}} = SocketIO.decode("2[not_json")
    end

    test "handles non-binary inputs" do
      assert {:error, :invalid_binary} = SocketIO.decode(nil)
      assert {:error, :invalid_binary} = SocketIO.decode(12345)
    end
  end
end
