defmodule NexusSocket.Protocol.SocketIO do
  @moduledoc """
  Socket.IO v4 (Revision 5) parser and serializer.

  Handles framing for Socket.IO packets layered inside Engine.IO message (`4`) frames:
  - 0: CONNECT
  - 1: DISCONNECT
  - 2: EVENT
  - 3: ACK
  - 4: CONNECT_ERROR
  - 5: BINARY_EVENT
  - 6: BINARY_ACK

  Wire format:
  `<type>[<nsp>,][<ack_id>][<payload>]`
  """

  @type packet_type ::
          :connect
          | :disconnect
          | :event
          | :ack
          | :connect_error
          | :binary_event
          | :binary_ack

  @type t :: %__MODULE__{
          type: packet_type(),
          nsp: String.t(),
          id: integer() | nil,
          data: term()
        }

  defstruct [:type, :id, :data, nsp: "/"]

  @doc """
  Decodes a raw Socket.IO wire packet string into a `%SocketIO{}` struct.
  """
  @spec decode(binary()) :: {:ok, t()} | {:error, term()}
  def decode(binary) when is_binary(binary) do
    with {:ok, type_char, rest} <- extract_type(binary),
         {:ok, type} <- parse_type(type_char),
         {:ok, nsp, rest} <- extract_nsp(rest),
         {:ok, id, rest} <- extract_id(rest),
         {:ok, data} <- parse_payload(type, rest) do
      {:ok, %__MODULE__{type: type, nsp: nsp, id: id, data: data}}
    end
  end

  def decode(_), do: {:error, :invalid_binary}

  @doc """
  Encodes a `%SocketIO{}` struct into a Socket.IO wire packet string.
  """
  @spec encode(t()) :: {:ok, binary()} | {:error, term()}
  def encode(%__MODULE__{type: type, nsp: nsp, id: id, data: data}) do
    with {:ok, type_code} <- type_to_code(type),
         {:ok, nsp_str} <- encode_nsp(nsp),
         {:ok, payload_str} <- encode_payload(data) do
      id_str = if is_integer(id), do: Integer.to_string(id), else: ""
      {:ok, type_code <> nsp_str <> id_str <> payload_str}
    end
  end

  def encode(_), do: {:error, :invalid_struct}

  # --- Internal Helpers ---

  defp extract_type(<<c::utf8, rest::binary>>), do: {:ok, c, rest}
  defp extract_type(""), do: {:error, :empty_packet}

  defp parse_type(?0), do: {:ok, :connect}
  defp parse_type(?1), do: {:ok, :disconnect}
  defp parse_type(?2), do: {:ok, :event}
  defp parse_type(?3), do: {:ok, :ack}
  defp parse_type(?4), do: {:ok, :connect_error}
  defp parse_type(?5), do: {:ok, :binary_event}
  defp parse_type(?6), do: {:ok, :binary_ack}
  defp parse_type(_), do: {:error, :invalid_packet_type}

  # If rest starts with '/', namespace extends until the first ','
  defp extract_nsp("/" <> rest) do
    case :binary.split(rest, ",") do
      [nsp, after_comma] -> {:ok, "/" <> nsp, after_comma}
      [nsp] -> {:ok, "/" <> nsp, ""}
    end
  end

  defp extract_nsp(rest), do: {:ok, "/", rest}

  # If decimal digits follow, extract acknowledgment ID
  defp extract_id(rest) do
    case take_digits(rest, "") do
      {"", remaining} -> {:ok, nil, remaining}
      {digits, remaining} -> {:ok, String.to_integer(digits), remaining}
    end
  end

  defp take_digits(<<c::utf8, rest::binary>>, acc) when c in ?0..?9 do
    take_digits(rest, acc <> <<c::utf8>>)
  end

  defp take_digits(rest, acc), do: {acc, rest}

  defp parse_payload(:connect, ""), do: {:ok, %{}}
  defp parse_payload(:disconnect, ""), do: {:ok, nil}
  defp parse_payload(_type, ""), do: {:ok, nil}

  defp parse_payload(type, payload) when is_binary(payload) do
    case Jason.decode(payload) do
      {:ok, list} when type == :event and is_list(list) ->
        case list do
          [event_name | _] when is_binary(event_name) -> {:ok, list}
          [] -> {:error, :empty_event_array}
          _ -> {:error, :invalid_event_format}
        end

      {:ok, not_list} when type == :event and not is_list(not_list) ->
        {:error, :event_payload_must_be_array}

      {:ok, decoded} ->
        {:ok, decoded}

      {:error, err} ->
        {:error, {:invalid_json, err}}
    end
  end

  defp type_to_code(:connect), do: {:ok, "0"}
  defp type_to_code(:disconnect), do: {:ok, "1"}
  defp type_to_code(:event), do: {:ok, "2"}
  defp type_to_code(:ack), do: {:ok, "3"}
  defp type_to_code(:connect_error), do: {:ok, "4"}
  defp type_to_code(:binary_event), do: {:ok, "5"}
  defp type_to_code(:binary_ack), do: {:ok, "6"}
  defp type_to_code(_), do: {:error, :unknown_type}

  defp encode_nsp("/"), do: {:ok, ""}
  defp encode_nsp(nsp) when is_binary(nsp), do: {:ok, nsp <> ","}
  defp encode_nsp(_), do: {:error, :invalid_namespace}

  defp encode_payload(nil), do: {:ok, ""}

  defp encode_payload(data) do
    case Jason.encode(data) do
      {:ok, json} -> {:ok, json}
      {:error, err} -> {:error, {:json_encode_error, err}}
    end
  end
end
