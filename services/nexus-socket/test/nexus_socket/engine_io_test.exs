defmodule NexusSocket.EngineIoTest do
  use ExUnit.Case, async: true
  alias NexusSocket.Protocol.EngineIO

  describe "Engine.IO v4 Handshake (F1)" do
    test "decodes valid handshake open packet" do
      raw = ~s(0{"sid":"cKz123","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000})
      assert {:ok, {:open, payload}} = EngineIO.decode(raw)
      assert payload["sid"] == "cKz123"
      assert payload["upgrades"] == []
      assert payload["pingInterval"] == 25000
      assert payload["pingTimeout"] == 20000
      assert payload["maxPayload"] == 1000000
    end

    test "encodes valid handshake open packet" do
      data = %{
        "sid" => "sess_abc",
        "upgrades" => ["websocket"],
        "pingInterval" => 25000,
        "pingTimeout" => 20000,
        "maxPayload" => 1000000
      }

      assert {:ok, encoded} = EngineIO.encode({:open, data})
      assert String.starts_with?(encoded, "0{")
      assert String.contains?(encoded, ~s("sid":"sess_abc"))
    end

    test "rejects malformed open packet with non-json body" do
      assert {:error, {:invalid_json, _}} = EngineIO.decode("0not_json")
    end

    test "rejects open packet with non-map JSON payload" do
      assert {:error, :invalid_open_payload} = EngineIO.decode("0123")
      assert {:error, :invalid_open_payload} = EngineIO.decode("0\"string\"")
    end

    test "round-trips handshake packet" do
      original = %{"sid" => "rt_1", "pingInterval" => 10000}
      assert {:ok, encoded} = EngineIO.encode({:open, original})
      assert {:ok, {:open, decoded}} = EngineIO.decode(encoded)
      assert decoded == original
    end
  end

  describe "Engine.IO v4 Heartbeat (F2)" do
    test "decodes server ping packet 2" do
      assert {:ok, :ping} = EngineIO.decode("2")
    end

    test "decodes client pong packet 3" do
      assert {:ok, :pong} = EngineIO.decode("3")
    end

    test "decodes client probe ping 2probe" do
      assert {:ok, {:ping, "probe"}} = EngineIO.decode("2probe")
    end

    test "decodes server probe pong 3probe" do
      assert {:ok, {:pong, "probe"}} = EngineIO.decode("3probe")
    end

    test "encodes ping and pong packets" do
      assert {:ok, "2"} = EngineIO.encode(:ping)
      assert {:ok, "3"} = EngineIO.encode(:pong)
      assert {:ok, "2probe"} = EngineIO.encode({:ping, "probe"})
      assert {:ok, "3probe"} = EngineIO.encode({:pong, "probe"})
    end

    test "encodes and decodes ping with custom payload" do
      assert {:ok, "2custom"} = EngineIO.encode({:ping, "custom"})
      assert {:ok, {:ping, "custom"}} = EngineIO.decode("2custom")
    end
  end

  describe "Engine.IO v4 Lifecycle & Upgrades" do
    test "decodes upgrade packet 5" do
      assert {:ok, :upgrade} = EngineIO.decode("5")
      assert {:ok, "5"} = EngineIO.encode(:upgrade)
    end

    test "decodes close packet 1" do
      assert {:ok, :close} = EngineIO.decode("1")
      assert {:ok, "1"} = EngineIO.encode(:close)
    end

    test "decodes noop packet 6" do
      assert {:ok, :noop} = EngineIO.decode("6")
      assert {:ok, "6"} = EngineIO.encode(:noop)
    end

    test "decodes message packet 4 with higher layer payload" do
      assert {:ok, {:message, "2[\"join_chat\",{}]"}} = EngineIO.decode("42[\"join_chat\",{}]")
    end

    test "encodes message packet 4" do
      assert {:ok, "4hello_payload"} = EngineIO.encode({:message, "hello_payload"})
    end
  end

  describe "Engine.IO Edge Cases & Error Handling" do
    test "returns error on empty packet" do
      assert {:error, :empty_packet} = EngineIO.decode("")
    end

    test "returns error on unknown packet type" do
      assert {:error, :unknown_engine_io_packet} = EngineIO.decode("7")
      assert {:error, :unknown_engine_io_packet} = EngineIO.decode("9unknown")
      assert {:error, :unknown_engine_io_packet} = EngineIO.decode("invalid")
    end

    test "returns error when encoding invalid term" do
      assert {:error, :invalid_packet_to_encode} = EngineIO.encode(:invalid_term)
    end
  end
end
