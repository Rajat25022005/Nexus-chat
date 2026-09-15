defmodule NexusSocket.Redis.Protocol do
  @moduledoc """
  REdis Serialization Protocol (RESP) encoder and streaming decoder.

  Provides zero-dependency, pure functional RESP handling for Redis Pub/Sub commands:
  - Encodes arbitrary Redis command lists into RESP Arrays (`*<count>\\r\\n$<len>\\r\\n<arg>...`)
  - Parses streaming RESP chunks including `:message` and `:pmessage` pub/sub packets
  - Handles incomplete TCP frame buffering gracefully
  """

  @type resp_value ::
          :ok
          | :pong
          | {:error, binary()}
          | {:integer, integer()}
          | binary()
          | nil
          | list(resp_value())
          | {:message, binary(), binary()}
          | {:pmessage, binary(), binary(), binary()}

  @doc """
  Encodes a Redis command argument list into RESP wire format.

  ## Examples

      iex> NexusSocket.Redis.Protocol.encode(["PING"])
      "*1\\r\\n$4\\r\\nPING\\r\\n"

      iex> NexusSocket.Redis.Protocol.encode(["PSUBSCRIBE", "room:*:ai_stream"])
      "*2\\r\\n$10\\r\\nPSUBSCRIBE\\r\\n$16\\r\\nroom:*:ai_stream\\r\\n"
  """
  @spec encode(list(binary() | integer())) :: binary()
  def encode(args) when is_list(args) do
    parts =
      Enum.map(args, fn arg ->
        str = to_string(arg)
        "$#{byte_size(str)}\r\n#{str}\r\n"
      end)

    "*#{length(args)}\r\n" <> Enum.join(parts, "")
  end

  @doc """
  Parses a raw binary buffer from a TCP socket.
  Returns `{:ok, parsed_value, rest}` when a complete frame is consumed,
  or `{:incomplete, buffer}` when more bytes are needed.
  """
  @spec decode(binary()) :: {:ok, resp_value(), binary()} | {:incomplete, binary()} | {:error, term(), binary()}
  def decode(""), do: {:incomplete, ""}

  # Simple String: +OK\r\n or +PONG\r\n
  def decode("+" <> rest) do
    case find_crlf(rest) do
      {:ok, line, remaining} ->
        case line do
          "OK" -> {:ok, :ok, remaining}
          "PONG" -> {:ok, :pong, remaining}
          other -> {:ok, other, remaining}
        end

      :incomplete ->
        {:incomplete, "+" <> rest}
    end
  end

  # Error: -ERR ...\r\n
  def decode("-" <> rest) do
    case find_crlf(rest) do
      {:ok, line, remaining} -> {:ok, {:error, line}, remaining}
      :incomplete -> {:incomplete, "-" <> rest}
    end
  end

  # Integer: :123\r\n
  def decode(":" <> rest) do
    case find_crlf(rest) do
      {:ok, line, remaining} ->
        case Integer.parse(line) do
          {int, ""} -> {:ok, {:integer, int}, remaining}
          _ -> {:error, :invalid_integer, remaining}
        end

      :incomplete ->
        {:incomplete, ":" <> rest}
    end
  end

  # Bulk String: $<len>\r\n<data>\r\n or $-1\r\n
  def decode("$" <> rest) do
    decode_bulk_string(rest)
  end

  # Array: *<count>\r\n...
  def decode("*" <> rest = original_buffer) do
    case find_crlf(rest) do
      {:ok, count_str, after_crlf} ->
        case Integer.parse(count_str) do
          {-1, ""} ->
            {:ok, nil, after_crlf}

          {count, ""} when count >= 0 ->
            decode_array_elements(count, after_crlf, original_buffer, [])

          _ ->
            {:error, :invalid_array_count, after_crlf}
        end

      :incomplete ->
        {:incomplete, original_buffer}
    end
  end

  def decode(other), do: {:error, :invalid_resp_prefix, other}

  # --- Internal Helpers ---

  defp decode_bulk_string(buffer) do
    case find_crlf(buffer) do
      {:ok, "-1", remaining} ->
        {:ok, nil, remaining}

      {:ok, len_str, after_header} ->
        case Integer.parse(len_str) do
          {len, ""} when len >= 0 ->
            if byte_size(after_header) >= len + 2 do
              <<data::binary-size(^len), "\r\n", remaining::binary>> = after_header
              {:ok, data, remaining}
            else
              {:incomplete, "$" <> buffer}
            end

          _ ->
            {:error, :invalid_bulk_length, after_header}
        end

      :incomplete ->
        {:incomplete, "$" <> buffer}
    end
  end

  defp decode_array_elements(0, remaining, _original, acc) do
    list = Enum.reverse(acc)
    # Recognize special Redis Pub/Sub shapes
    case list do
      ["pmessage", pattern, channel, payload] ->
        {:ok, {:pmessage, pattern, channel, payload}, remaining}

      ["message", channel, payload] ->
        {:ok, {:message, channel, payload}, remaining}

      other ->
        {:ok, other, remaining}
    end
  end

  defp decode_array_elements(count, buffer, original, acc) do
    case decode(buffer) do
      {:ok, elem, remaining} ->
        decode_array_elements(count - 1, remaining, original, [elem | acc])

      {:incomplete, _} ->
        {:incomplete, original}

      {:error, reason, remaining} ->
        {:error, reason, remaining}
    end
  end

  defp find_crlf(binary) do
    case :binary.split(binary, "\r\n") do
      [line, rest] -> {:ok, line, rest}
      [_incomplete] -> :incomplete
    end
  end
end
