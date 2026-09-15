defmodule NexusSocket.Redis.Publisher do
  @moduledoc """
  High-performance Redis publisher GenServer.

  Provides non-blocking publishing of messages, events, and telemetry to Redis:
  - `publish/2`: Publishes raw strings or JSON-serializable maps/structs to any channel
  - Automatic reconnection handling
  - Graceful fallback when Redis is offline or disabled
  """

  use GenServer
  require Logger
  alias NexusSocket.Redis.Protocol
  alias NexusSocket.Redis.Subscriber

  @reconnect_interval_ms 2_000

  defstruct [
    :socket,
    :host,
    :port,
    :password,
    :url,
    status: :disconnected,
    reconnect_timer: nil
  ]

  # --- Client API ---

  @doc """
  Starts the Redis Publisher under a supervisor.
  """
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Publishes a message or map (encoded to JSON) to a Redis channel.
  """
  @spec publish(binary(), binary() | map() | list()) :: :ok | {:error, term()}
  def publish(channel, payload) when is_binary(channel) do
    case GenServer.whereis(__MODULE__) do
      nil ->
        {:error, :not_started}

      pid ->
        data =
          if is_binary(payload) do
            payload
          else
            Jason.encode!(payload)
          end

        GenServer.call(pid, {:publish, channel, data})
    end
  end

  @doc """
  Returns current publisher connection status.
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
      {:ok, %__MODULE__{status: :disabled, url: redis_url}}
    else
      {host, port, password} = Subscriber.parse_redis_url(redis_url)

      state = %__MODULE__{
        host: host,
        port: port,
        password: password,
        url: redis_url,
        status: :disconnected
      }

      send(self(), :connect)
      {:ok, state}
    end
  end

  @impl true
  def handle_call({:publish, _channel, _data}, _from, %{status: :disabled} = state) do
    {:reply, {:error, :redis_disabled}, state}
  end

  def handle_call({:publish, _channel, _data}, _from, %{status: :disconnected} = state) do
    {:reply, {:error, :not_connected}, state}
  end

  def handle_call({:publish, channel, data}, _from, %{socket: socket, status: :connected} = state) do
    cmd = Protocol.encode(["PUBLISH", channel, data])

    case :gen_tcp.send(socket, cmd) do
      :ok ->
        {:reply, :ok, state}

      {:error, reason} ->
        Logger.warning("[Redis.Publisher] Failed to send PUBLISH: #{inspect(reason)}")
        {:reply, {:error, reason}, state}
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

    tcp_opts = [:binary, packet: :line, active: true, keepalive: true]

    case :gen_tcp.connect(to_charlist(state.host), state.port, tcp_opts, 3000) do
      {:ok, socket} ->
        Logger.info("[Redis.Publisher] Connected to Redis at #{state.host}:#{state.port}")

        if state.password do
          :gen_tcp.send(socket, Protocol.encode(["AUTH", state.password]))
        end

        {:noreply, %{state | socket: socket, status: :connected}}

      {:error, _reason} ->
        ref = Process.send_after(self(), :connect, @reconnect_interval_ms)
        {:noreply, %{state | socket: nil, status: :disconnected, reconnect_timer: ref}}
    end
  end

  @impl true
  def handle_info({:tcp, _socket, _data}, state) do
    # Consume responses (e.g. subscriber counts from PUBLISH :1\r\n)
    {:noreply, state}
  end

  @impl true
  def handle_info({:tcp_closed, socket}, %{socket: socket} = state) do
    ref = Process.send_after(self(), :connect, @reconnect_interval_ms)
    {:noreply, %{state | socket: nil, status: :disconnected, reconnect_timer: ref}}
  end

  @impl true
  def handle_info({:tcp_error, socket, _reason}, %{socket: socket} = state) do
    :gen_tcp.close(socket)
    ref = Process.send_after(self(), :connect, @reconnect_interval_ms)
    {:noreply, %{state | socket: nil, status: :disconnected, reconnect_timer: ref}}
  end

  @impl true
  def terminate(_reason, %{socket: socket}) when is_port(socket) do
    :gen_tcp.close(socket)
    :ok
  end

  def terminate(_reason, _state), do: :ok

  defp cancel_timer(%{reconnect_timer: nil} = state), do: state

  defp cancel_timer(%{reconnect_timer: ref} = state) do
    Process.cancel_timer(ref)
    %{state | reconnect_timer: nil}
  end
end
