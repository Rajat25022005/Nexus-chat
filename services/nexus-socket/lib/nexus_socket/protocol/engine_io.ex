defmodule NexusSocket.Protocol.EngineIO do
  @moduledoc """
  Engine.IO v4 protocol parser and serializer.

  Handles low-level transport framing for Engine.IO v4 (used by Socket.IO v4):
  - 0: open (handshake packet)
  - 1: close
  - 2: ping (heartbeat sent by server, or probe sent by client during upgrade)
  - 3: pong (heartbeat response from client, or probe response from server)
  - 4: message (contains higher-level Socket.IO payload)
  - 5: upgrade (client confirms transport switch)
  - 6: noop (used during polling upgrade)
  """

  @type packet ::
          {:open, map()}
          | :close
          | :ping
          | {:ping, binary()}
          | :pong
          | {:pong, binary()}
          | {:message, binary()}
          | :upgrade
          | :noop

  @doc """
  Decodes a raw Engine.IO v4 frame into a structured packet tuple.
  """
  @spec decode(binary()) :: {:ok, packet()} | {:error, term()}
  def decode("0" <> json) do
    case Jason.decode(json) do
      {:ok, data} when is_map(data) -> {:ok, {:open, data}}
      {:ok, _} -> {:error, :invalid_open_payload}
      {:error, err} -> {:error, {:invalid_json, err}}
    end
  end

  def decode("1"), do: {:ok, :close}
  def decode("2"), do: {:ok, :ping}
  def decode("2" <> payload), do: {:ok, {:ping, payload}}
  def decode("3"), do: {:ok, :pong}
  def decode("3" <> payload), do: {:ok, {:pong, payload}}
  def decode("4" <> payload), do: {:ok, {:message, payload}}
  def decode("5"), do: {:ok, :upgrade}
  def decode("6"), do: {:ok, :noop}
  def decode(""), do: {:error, :empty_packet}
  def decode(_), do: {:error, :unknown_engine_io_packet}

  @doc """
  Encodes a structured packet tuple into a raw Engine.IO v4 string.
  """
  @spec encode(packet()) :: {:ok, binary()} | {:error, term()}
  def encode({:open, data}) when is_map(data) do
    case Jason.encode(data) do
      {:ok, json} -> {:ok, "0" <> json}
      {:error, err} -> {:error, {:json_encode_error, err}}
    end
  end

  def encode(:close), do: {:ok, "1"}
  def encode(:ping), do: {:ok, "2"}
  def encode({:ping, payload}) when is_binary(payload), do: {:ok, "2" <> payload}
  def encode(:pong), do: {:ok, "3"}
  def encode({:pong, payload}) when is_binary(payload), do: {:ok, "3" <> payload}
  def encode({:message, payload}) when is_binary(payload), do: {:ok, "4" <> payload}
  def encode(:upgrade), do: {:ok, "5"}
  def encode(:noop), do: {:ok, "6"}
  def encode(_), do: {:error, :invalid_packet_to_encode}
end
