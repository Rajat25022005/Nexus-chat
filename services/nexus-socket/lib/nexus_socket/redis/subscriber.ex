defmodule NexusSocket.Redis.Subscriber do
  @moduledoc """
  High-concurrency Redis Pub/Sub subscriber.

  Subscribes to external Redis channels and translates them into internal Phoenix.PubSub broadcasts:
  1. `room:*:ai_stream`: Pattern-subscribes to AI inference chunks published by `nexus-ai-worker`.
     Routes deltas to `NexusSocket.AiStreamBuffer` for adaptive micro-batching and fan-out.
  2. `nexus:broadcast`: Subscribes to cross-service system messages, routing to room topics.

  Fault Tolerance:
  - Self-healing reconnection loop with 2s backoff on TCP close/errors.
  - Non-blocking: application boots and operates smoothly even if Redis is initially offline.
  - Disabled gracefully when `REDIS_URL` is set to `"none"`, `"disabled"`, or unconfigured.
  """

  use GenServer
  require Logger
  alias NexusSocket.Redis.Protocol

  @reconnect_interval_ms 2_000
  @default_port 6379
  @default_host "127.0.0.1"

  defstruct [
    :socket,
    :host,
    :port,
    :password,
    :url,
    status: :disconnected,
    buffer: "",
    reconnect_timer: nil
  ]

  # --- Client API ---

  @doc """
  Starts the Redis Subscriber under a supervisor.
  """
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Returns current subscriber connection status and metadata.
  """
  @spec status() :: map()
  def status do
    case GenServer.whereis(__MODULE__) do
      nil -> %{status: :not_started}
      pid -> GenServer.call(pid, :status)
    end
  end

  @doc """
  Returns true if currently connected to Redis.
  """
  @spec connected?() :: boolean()
  def connected? do
    case GenServer.whereis(__MODULE__) do
      nil -> false
      pid -> GenServer.call(pid, :connected?)
    end
  end

  # --- GenServer Callbacks ---

  @impl true
  def init(opts) do
    redis_url =
      Keyword.get(opts, :redis_url) ||
        Application.get_env(:nexus_socket, :redis_url) ||
        System.get_env("REDIS_URL") ||
        "redis://localhost:6379"

    if redis_url in [nil, "", "none", "disabled"] do
      Logger.info("[Redis.Subscriber] REDIS_URL is disabled or not configured; pub/sub bridge inactive")
      {:ok, %__MODULE__{status: :disabled, url: redis_url}}
    else
      {host, port, password} = parse_redis_url(redis_url)

      state = %__MODULE__{
        host: host,
        port: port,
        password: password,
        url: redis_url,
        status: :disconnected
      }

      # Connect asynchronously so supervisor does not block on boot
      send(self(), :connect)
      {:ok, state}
    end
  end

  @impl true
  def handle_call(:status, _from, state) do
    {:reply, %{status: state.status, host: state.host, port: state.port, url: state.url}, state}
  end

  @impl true
  def handle_call(:connected?, _from, state) do
    {:reply, state.status == :connected, state}
  end

  @impl true
  def handle_info(:connect, %{status: :disabled} = state), do: {:noreply, state}

  def handle_info(:connect, state) do
    state = cancel_timer(state)

    tcp_opts = [:binary, packet: :raw, active: true, keepalive: true]

    case :gen_tcp.connect(to_charlist(state.host), state.port, tcp_opts, 3000) do
      {:ok, socket} ->
        Logger.info("[Redis.Subscriber] Connected to Redis at #{state.host}:#{state.port}")

        # Send AUTH if password provided
        if state.password do
          :gen_tcp.send(socket, Protocol.encode(["AUTH", state.password]))
        end

        # Subscribe to AI streaming topic and generic broadcast topic
        :gen_tcp.send(socket, Protocol.encode(["PSUBSCRIBE", "room:*:ai_stream"]))
        :gen_tcp.send(socket, Protocol.encode(["SUBSCRIBE", "nexus:broadcast"]))

        {:noreply, %{state | socket: socket, status: :connected, buffer: ""}}

      {:error, reason} ->
        Logger.warning(
          "[Redis.Subscriber] Unable to connect to Redis at #{state.host}:#{state.port} (#{inspect(reason)}). Retrying in #{@reconnect_interval_ms}ms..."
        )

        ref = Process.send_after(self(), :connect, @reconnect_interval_ms)
        {:noreply, %{state | socket: nil, status: :disconnected, reconnect_timer: ref}}
    end
  end

  # Incoming data from Redis TCP socket
  @impl true
  def handle_info({:tcp, socket, data}, %{socket: socket} = state) do
    new_buffer = state.buffer <> data
    {remaining, state} = process_buffer(new_buffer, state)
    {:noreply, %{state | buffer: remaining}}
  end

  # TCP Socket closed or error
  @impl true
  def handle_info({:tcp_closed, socket}, %{socket: socket} = state) do
    Logger.warning("[Redis.Subscriber] Redis socket closed by server. Reconnecting in #{@reconnect_interval_ms}ms...")
    ref = Process.send_after(self(), :connect, @reconnect_interval_ms)
    {:noreply, %{state | socket: nil, status: :disconnected, reconnect_timer: ref, buffer: ""}}
  end

  @impl true
  def handle_info({:tcp_error, socket, reason}, %{socket: socket} = state) do
    Logger.error("[Redis.Subscriber] Redis TCP error: #{inspect(reason)}. Reconnecting in #{@reconnect_interval_ms}ms...")
    :gen_tcp.close(socket)
    ref = Process.send_after(self(), :connect, @reconnect_interval_ms)
    {:noreply, %{state | socket: nil, status: :disconnected, reconnect_timer: ref, buffer: ""}}
  end

  @impl true
  def terminate(_reason, %{socket: socket}) when is_port(socket) do
    :gen_tcp.close(socket)
    :ok
  end

  def terminate(_reason, _state), do: :ok

  # --- Internal Processing ---

  defp process_buffer(buffer, state) do
    case Protocol.decode(buffer) do
      {:ok, resp_value, rest} ->
        handle_redis_message(resp_value)
        process_buffer(rest, state)

      {:incomplete, remaining} ->
        {remaining, state}

      {:error, reason, rest} ->
        Logger.warning("[Redis.Subscriber] RESP decode error: #{inspect(reason)}")
        {rest, state}
    end
  end

  # Pattern match: room:<chat_id>:ai_stream
  defp handle_redis_message({:pmessage, "room:*:ai_stream", channel, payload}) do
    case extract_chat_id(channel) do
      {:ok, chat_id} ->
        dispatch_ai_chunk(chat_id, payload)

      :error ->
        Logger.warning("[Redis.Subscriber] Could not extract chatId from channel #{channel}")
    end
  end

  # Generic broadcast message: nexus:broadcast
  defp handle_redis_message({:message, "nexus:broadcast", payload}) do
    case Jason.decode(payload) do
      {:ok, %{"topic" => topic, "event" => event} = msg} ->
        event_payload = Map.get(msg, "payload", %{})

        Phoenix.PubSub.broadcast(
          NexusSocket.PubSub,
          topic,
          {:socket_broadcast, event, event_payload}
        )

      _ ->
        Logger.warning("[Redis.Subscriber] Invalid payload on nexus:broadcast: #{inspect(payload)}")
    end
  end

  # Acknowledgment of subscriptions or commands
  defp handle_redis_message(["psubscribe", pattern, _count]) do
    Logger.info("[Redis.Subscriber] Subscribed to pattern: #{pattern}")
  end

  defp handle_redis_message(["subscribe", channel, _count]) do
    Logger.info("[Redis.Subscriber] Subscribed to channel: #{channel}")
  end

  defp handle_redis_message(_other), do: :ok

  defp dispatch_ai_chunk(chat_id, payload) do
    case Jason.decode(payload) do
      {:ok, chunk} when is_map(chunk) ->
        delta = Map.get(chunk, "delta", "")
        is_final = Map.get(chunk, "is_final") || Map.get(chunk, "isFinal") || false
        message_id = Map.get(chunk, "message_id") || Map.get(chunk, "messageId") || ""

        # Push to adaptive micro-batching buffer
        NexusSocket.AiStreamBuffer.push(chat_id, message_id, delta, is_final)

      {:error, err} ->
        Logger.warning("[Redis.Subscriber] JSON decode error on AI stream payload: #{inspect(err)}")
    end
  end

  defp extract_chat_id("room:" <> rest) do
    if String.ends_with?(rest, ":ai_stream") do
      chat_id = String.slice(rest, 0, byte_size(rest) - byte_size(":ai_stream"))
      {:ok, chat_id}
    else
      :error
    end
  end

  defp extract_chat_id(_), do: :error

  defp cancel_timer(%{reconnect_timer: nil} = state), do: state

  defp cancel_timer(%{reconnect_timer: ref} = state) do
    Process.cancel_timer(ref)
    %{state | reconnect_timer: nil}
  end

  @doc """
  Parses a Redis connection string into `{host, port, password}`.
  Supports:
  - `redis://localhost:6379`
  - `redis://127.0.0.1:6379/0`
  - `redis://:mypassword@redis-host:6380`
  - `localhost:6379`
  """
  @spec parse_redis_url(binary()) :: {binary(), integer(), binary() | nil}
  def parse_redis_url(url) when is_binary(url) do
    # Add scheme if missing
    full_url = if String.contains?(url, "://"), do: url, else: "redis://" <> url
    uri = URI.parse(full_url)

    host = uri.host || @default_host
    port = uri.port || @default_port

    password =
      case uri.userinfo do
        nil -> nil
        "" -> nil
        userinfo ->
          case String.split(userinfo, ":", parts: 2) do
            ["", pass] -> pass
            [_, pass] -> pass
            [pass] -> pass
          end
      end

    {host, port, password}
  end
end
