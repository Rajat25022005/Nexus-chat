defmodule NexusSocket.Transport.WebSocketHandler do
  @moduledoc """
  Bandit WebSocket transport handler implementing the `WebSock` behaviour.

  Coordinates the Engine.IO v4 and Socket.IO v4 protocol state machine:
  - Dispatches Engine.IO handshake `0` on connection
  - Emits server-initiated ping `2` every `ping_interval` ms
  - Enforces client pong `3` watchdog within `ping_timeout` ms
  - Handles Socket.IO authentication (`40`), event routing (`42`), and acks (`43`)
  - Ensures clean presence untracking on client disconnect or process crash
  """

  @behaviour WebSock

  alias NexusSocket.Protocol.EngineIO
  alias NexusSocket.Protocol.SocketIO
  alias NexusSocket.Channels.ChannelHandler

  @default_ping_interval 25_000
  @default_ping_timeout 20_000
  @default_max_payload 1_000_000

  defstruct [
    :sid,
    :status,
    :user,
    :joined_rooms,
    :ping_interval,
    :ping_timeout,
    :ping_timer,
    :timeout_timer
  ]

  @impl WebSock
  def init(_opts) do
    sid = generate_sid()
    ping_interval = Application.get_env(:nexus_socket, :ping_interval, @default_ping_interval)
    ping_timeout = Application.get_env(:nexus_socket, :ping_timeout, @default_ping_timeout)
    max_payload = Application.get_env(:nexus_socket, :max_payload, @default_max_payload)

    handshake_payload = %{
      "sid" => sid,
      "upgrades" => [],
      "pingInterval" => ping_interval,
      "pingTimeout" => ping_timeout,
      "maxPayload" => max_payload
    }

    {:ok, open_frame} = EngineIO.encode({:open, handshake_payload})

    ping_timer = schedule_ping(ping_interval)

    state = %__MODULE__{
      sid: sid,
      status: :handshake,
      user: nil,
      joined_rooms: MapSet.new(),
      ping_interval: ping_interval,
      ping_timeout: ping_timeout,
      ping_timer: ping_timer,
      timeout_timer: nil
    }

    {:push, {:text, open_frame}, state}
  end

  @impl WebSock
  def handle_in({payload, opcode: :text}, state) when is_binary(payload) do
    case EngineIO.decode(payload) do
      {:ok, :ping} ->
        # Heartbeat ping from client -> reply with pong
        {:push, {:text, "3"}, state}

      {:ok, {:ping, "probe"}} ->
        # Transport upgrade probe from client -> reply 3probe
        {:push, {:text, "3probe"}, state}

      {:ok, {:ping, custom_payload}} ->
        {:push, {:text, "3" <> custom_payload}, state}

      {:ok, :pong} ->
        # Client replied to server ping -> cancel watchdog and schedule next ping
        cancel_timer(state.timeout_timer)
        ping_timer = schedule_ping(state.ping_interval)
        {:ok, %{state | timeout_timer: nil, ping_timer: ping_timer}}

      {:ok, :upgrade} ->
        # Transport upgrade confirmation
        {:ok, state}

      {:ok, :close} ->
        {:stop, :normal, state}

      {:ok, {:message, socket_io_payload}} ->
        handle_socket_io_packet(socket_io_payload, state)

      {:error, _reason} ->
        # Ignore unparseable frames or malformed Engine.IO
        {:ok, state}
    end
  end

  def handle_in(_other, state), do: {:ok, state}

  @impl WebSock
  def handle_info(:send_ping, state) do
    # Server sends Engine.IO ping "2" and arms watchdog timer
    timeout_timer = schedule_timeout(state.ping_timeout)
    {:push, {:text, "2"}, %{state | timeout_timer: timeout_timer}}
  end

  def handle_info(:ping_timeout, state) do
    # Client did not answer ping within timeout -> close connection
    {:stop, :normal, {1000, "Ping timeout"}, state}
  end

  def handle_info({:socket_broadcast, event_name, payload}, state) do
    with {:ok, sio_payload} <- SocketIO.encode(%SocketIO{type: :event, nsp: "/", data: [event_name, payload]}),
         {:ok, frame} <- EngineIO.encode({:message, sio_payload}) do
      {:push, {:text, frame}, state}
    else
      _ -> {:ok, state}
    end
  end

  def handle_info({:presence_joined, _topic, payload}, state) do
    handle_info({:socket_broadcast, "user_joined", payload}, state)
  end

  def handle_info({:presence_left, _topic, payload}, state) do
    handle_info({:socket_broadcast, "user_left", payload}, state)
  end

  def handle_info(_other, state) do
    {:ok, state}
  end

  @impl WebSock
  def terminate(_reason, state) do
    cancel_timer(state.ping_timer)
    cancel_timer(state.timeout_timer)

    if state.user do
      for room <- state.joined_rooms do
        NexusSocket.Presence.Tracker.untrack(self(), room, state.user.user_id)
        chat_id = String.replace_prefix(room, "chat:", "")

        Phoenix.PubSub.broadcast(
          NexusSocket.PubSub,
          room,
          {:socket_broadcast, "user_left",
           %{
             "userId" => state.user.user_id,
             "name" => state.user.name,
             "chatId" => chat_id
           }}
        )
      end
    end

    :ok
  end

  # --- Socket.IO Internal Packet Handling ---

  defp handle_socket_io_packet(raw_sio, state) do
    case SocketIO.decode(raw_sio) do
      {:ok, %SocketIO{type: :connect, data: auth_payload}} ->
        handle_connect(auth_payload, state)

      {:ok, %SocketIO{type: :event, id: ack_id, data: [event_name | rest_args]}} ->
        handle_event(event_name, List.first(rest_args) || %{}, ack_id, state)

      {:ok, %SocketIO{type: :disconnect}} ->
        {:stop, :normal, state}

      _ ->
        {:ok, state}
    end
  end

  defp handle_connect(auth_payload, state) do
    token = extract_token(auth_payload)

    if is_nil(token) do
      # Reject with authentication required
      error_packet = "44" <> Jason.encode!(%{"message" => "Authentication required"})
      {:stop, :normal, {1008, "Authentication required"}, [{:text, error_packet}], state}
    else
      case NexusSocket.Auth.Cache.authenticate(token) do
        {:ok, claims} ->
          user = %{
            user_id: claims["user_id"],
            email: claims["email"],
            name: claims["email"]
          }

          ack_packet = "40" <> Jason.encode!(%{"sid" => state.sid})
          new_state = %{state | status: :connected, user: user}
          {:push, {:text, ack_packet}, new_state}

        {:error, _reason} ->
          error_packet = "44" <> Jason.encode!(%{"message" => "Invalid authentication token"})
          {:stop, :normal, {1008, "Invalid authentication token"}, [{:text, error_packet}], state}
      end
    end
  end

  defp handle_event(event_name, payload, ack_id, %{status: :connected} = state) do
    case ChannelHandler.handle_event(event_name, payload, state.user, state) do
      {:reply, ack_data, new_state} ->
        if ack_id != nil do
          ack_frame = "43" <> Integer.to_string(ack_id) <> Jason.encode!([ack_data])
          {:push, {:text, ack_frame}, new_state}
        else
          {:ok, new_state}
        end

      {:noreply, new_state} ->
        {:ok, new_state}
    end
  end

  defp handle_event(_event_name, _payload, _ack_id, state) do
    # Disallow events before connection handshake
    {:stop, :normal, state}
  end

  defp extract_token(auth) when is_map(auth) do
    Map.get(auth, "token") || Map.get(auth, :token)
  end

  defp extract_token(_), do: nil

  defp schedule_ping(interval) when is_integer(interval) and interval > 0 do
    Process.send_after(self(), :send_ping, interval)
  end

  defp schedule_timeout(timeout) when is_integer(timeout) and timeout > 0 do
    Process.send_after(self(), :ping_timeout, timeout)
  end

  defp cancel_timer(nil), do: :ok
  defp cancel_timer(ref) when is_reference(ref), do: Process.cancel_timer(ref)

  defp generate_sid do
    :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)
  end
end
