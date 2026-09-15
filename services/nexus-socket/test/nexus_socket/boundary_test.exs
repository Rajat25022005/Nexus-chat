defmodule NexusSocket.BoundaryTest do
  use ExUnit.Case, async: true

  alias NexusSocket.Protocol.SocketIO
  alias NexusSocket.Auth.Jwt
  alias NexusSocket.Channels.ChannelHandler

  describe "Tier 2: Boundary Value Analysis" do
    test "BVA-1: Handles unicode, multiline text, and emojis in message content" do
      user = %{user_id: "u-unicode", email: "u@test.com", name: "Unicode Tester"}
      state = %{joined_rooms: MapSet.new()}

      content = "🌟 Multi-line\n🎉 Unicode: 日本語 / العربية / 🚀 / 🧑🏽‍💻 / \r\nSpecial: <>&\"'"
      payload = %{"chatId" => "chat-unicode", "content" => content}

      assert {:reply, ack, _} = ChannelHandler.handle_event("send_message", payload, user, state)
      assert ack["success"] == true
    end

    test "BVA-2: Large payload framing up to 100KB" do
      large_content = String.duplicate("A", 100_000)
      packet = %SocketIO{type: :event, nsp: "/", id: 1, data: ["large_event", %{"body" => large_content}]}

      assert {:ok, encoded} = SocketIO.encode(packet)
      assert byte_size(encoded) > 100_000
      assert {:ok, decoded} = SocketIO.decode(encoded)
      assert decoded.id == 1
      assert [event_name, data] = decoded.data
      assert event_name == "large_event"
      assert byte_size(data["body"]) == 100_000
    end

    test "BVA-3: Token expiration boundary (exact second boundary)" do
      now = System.system_time(:second)

      # Token expiring 10 seconds ago
      claims_past = %{"user_id" => "u-past", "email" => "past@test.com", "exp" => now - 10}
      {:ok, token_past} = Jwt.sign(claims_past, -10)
      assert {:error, :token_expired} = Jwt.verify(token_past)

      # Token expiring 100 seconds in future
      claims_future = %{"user_id" => "u-fut", "email" => "fut@test.com", "exp" => now + 100}
      {:ok, token_future} = Jwt.sign(claims_future, 100)
      assert {:ok, _} = Jwt.verify(token_future)
    end

    test "BVA-4: Extremely large Ack IDs" do
      max_ack = 9_999_999_999
      packet = %SocketIO{type: :ack, nsp: "/", id: max_ack, data: [%{"ok" => true}]}
      assert {:ok, encoded} = SocketIO.encode(packet)
      assert String.starts_with?(encoded, "39999999999")
      assert {:ok, decoded} = SocketIO.decode(encoded)
      assert decoded.id == max_ack
    end

    test "BVA-5: Deeply nested JSON payload" do
      nested_data = %{"level1" => %{"level2" => %{"level3" => %{"array" => [1, 2, %{"leaf" => true}]}}}}
      packet = %SocketIO{type: :event, nsp: "/", id: nil, data: ["nested", nested_data]}

      assert {:ok, encoded} = SocketIO.encode(packet)
      assert {:ok, decoded} = SocketIO.decode(encoded)
      assert decoded.data == ["nested", nested_data]
    end

    test "BVA-6: Rapid presence track and untrack cycles" do
      topic = "chat:churn-test"
      user_id = "user-churn"

      for i <- 1..25 do
        meta = %{name: "Churn #{i}", email: "c@test.com"}
        assert {:ok, _} = NexusSocket.Presence.Tracker.track(self(), topic, user_id, meta)
        assert :ok = NexusSocket.Presence.Tracker.untrack(self(), topic, user_id)
      end
    end
  end
end
