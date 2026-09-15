defmodule NexusSocket.CombinatorialPairwiseTest do
  use ExUnit.Case, async: true

  alias NexusSocket.Protocol.SocketIO
  alias NexusSocket.Channels.ChannelHandler

  describe "Tier 3: Pairwise Combinatorial Testing" do
    @namespaces ["/", "/chat", "/workspace/10"]
    @ack_ids [nil, 0, 1, 42, 8888]

    test "PW-1: Pairwise combinations of namespaces and Ack IDs on EVENT packets" do
      for nsp <- @namespaces,
          ack_id <- @ack_ids do
        packet = %SocketIO{
          type: :event,
          nsp: nsp,
          id: ack_id,
          data: ["test_event", %{"payload" => 123}]
        }

        assert {:ok, encoded} = SocketIO.encode(packet)
        assert {:ok, decoded} = SocketIO.decode(encoded)
        assert decoded.type == :event
        assert decoded.nsp == nsp
        assert decoded.id == ack_id
        assert decoded.data == ["test_event", %{"payload" => 123}]
      end
    end

    test "PW-2: Pairwise combinations of namespaces and Ack IDs on ACK packets" do
      for nsp <- @namespaces,
          ack_id <- [0, 1, 999] do
        packet = %SocketIO{
          type: :ack,
          nsp: nsp,
          id: ack_id,
          data: [%{"status" => "ok", "code" => 200}]
        }

        assert {:ok, encoded} = SocketIO.encode(packet)
        assert {:ok, decoded} = SocketIO.decode(encoded)
        assert decoded.type == :ack
        assert decoded.nsp == nsp
        assert decoded.id == ack_id
        assert decoded.data == [%{"status" => "ok", "code" => 200}]
      end
    end

    test "PW-3: Pairwise event handling across various payload data types" do
      user = %{user_id: "pw-user", email: "pw@test.com", name: "PW User"}
      state = %{joined_rooms: MapSet.new()}

      # send_message with various optional fields
      combinations = [
        %{"chatId" => "c1", "content" => "c1", "groupId" => "g1"},
        %{"chatId" => "c2", "content" => "c2", "tenantId" => "t1", "workspaceId" => "w1"},
        %{"chatId" => "c3", "content" => "c3", "triggerAI" => true, "tempId" => "tmp-3"},
        %{"chatId" => "c4", "content" => "c4", "replyTo" => %{"id" => "m0", "content" => "prev"}}
      ]

      for payload <- combinations do
        assert {:reply, ack, _} = ChannelHandler.handle_event("send_message", payload, user, state)
        assert ack["success"] == true
        assert is_binary(ack["messageId"])
      end
    end
  end
end
