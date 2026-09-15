defmodule NexusSocket.Endpoint do
  @moduledoc """
  Plug router for HTTP endpoints and WebSocket upgrade gateway.

  Handles:
  - `/socket.io/*`: WebSocket upgrade and HTTP long-polling handshake
  - `/health`: Liveness health check
  - `/ready`: Readiness check
  """

  use Plug.Router

  plug CORSPlug,
    origin: ["*"],
    credentials: true,
    headers: [
      "Authorization",
      "Content-Type",
      "Accept",
      "Origin",
      "User-Agent",
      "DNT",
      "Cache-Control",
      "X-Mx-ReqToken",
      "Keep-Alive",
      "X-Requested-With",
      "If-Modified-Since"
    ]

  plug :match
  plug :dispatch

  # WebSocket upgrade and Engine.IO polling on /socket.io/*
  match "/socket.io" do
    handle_socket_io(conn)
  end

  match "/socket.io/*_path" do
    handle_socket_io(conn)
  end

  get "/health" do
    send_resp(conn, 200, Jason.encode!(%{"status" => "healthy", "service" => "nexus-socket"}))
  end

  get "/ready" do
    send_resp(conn, 200, Jason.encode!(%{"status" => "ready", "service" => "nexus-socket"}))
  end

  get "/metrics" do
    mem = :erlang.memory()
    total_mem_mb = Float.round(mem[:total] / (1024 * 1024), 2)
    processes_mem_mb = Float.round(mem[:processes] / (1024 * 1024), 2)
    binary_mem_mb = Float.round(mem[:binary] / (1024 * 1024), 2)
    ets_mem_mb = Float.round(mem[:ets] / (1024 * 1024), 2)

    redis_conn =
      try do
        NexusSocket.Redis.Subscriber.connected?()
      rescue
        _ -> false
      end

    {reductions_total, _} = :erlang.statistics(:reductions)
    {context_switches_total, _} = :erlang.statistics(:context_switches)
    {runtime_ms, _} = :erlang.statistics(:runtime)
    {wall_clock_ms, _} = :erlang.statistics(:wall_clock)

    metrics = %{
      "process_count" => :erlang.system_info(:process_count),
      "process_limit" => :erlang.system_info(:process_limit),
      "port_count" => :erlang.system_info(:port_count),
      "port_limit" => :erlang.system_info(:port_limit),
      "schedulers" => :erlang.system_info(:schedulers_online),
      "run_queue" => :erlang.statistics(:run_queue),
      "run_queue_lengths" => :erlang.statistics(:run_queue_lengths_all),
      "total_run_queue_lengths" => :erlang.statistics(:total_run_queue_lengths_all),
      "active_tasks" => :erlang.statistics(:total_active_tasks_all),
      "active_tasks_per_scheduler" => :erlang.statistics(:active_tasks_all),
      "reductions" => reductions_total,
      "context_switches" => context_switches_total,
      "runtime_ms" => runtime_ms,
      "wall_clock_ms" => wall_clock_ms,
      "memory" => %{
        "total_mb" => total_mem_mb,
        "processes_mb" => processes_mem_mb,
        "binary_mb" => binary_mem_mb,
        "ets_mb" => ets_mem_mb
      },
      "redis_connected" => redis_conn
    }

    conn
    |> Plug.Conn.put_resp_content_type("application/json")
    |> send_resp(200, Jason.encode!(metrics))
  end

  match _ do
    send_resp(conn, 404, Jason.encode!(%{"error" => "Not Found"}))
  end

  # --- Internal Helpers ---

  defp handle_socket_io(conn) do
    conn = Plug.Conn.fetch_query_params(conn)

    is_websocket =
      case Plug.Conn.get_req_header(conn, "upgrade") do
        [val | _] -> String.downcase(val) == "websocket"
        [] -> Map.get(conn.query_params, "transport") == "websocket"
      end

    if is_websocket do
      WebSockAdapter.upgrade(conn, NexusSocket.Transport.WebSocketHandler, [], timeout: 60_000)
    else
      handle_polling(conn)
    end
  end

  defp handle_polling(conn) do
    case conn.method do
      "GET" ->
        # Send Engine.IO open packet with upgrade capability to websocket
        sid = :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)
        ping_interval = Application.get_env(:nexus_socket, :ping_interval, 25_000)
        ping_timeout = Application.get_env(:nexus_socket, :ping_timeout, 20_000)
        max_payload = Application.get_env(:nexus_socket, :max_payload, 1_000_000)

        handshake = %{
          "sid" => sid,
          "upgrades" => ["websocket"],
          "pingInterval" => ping_interval,
          "pingTimeout" => ping_timeout,
          "maxPayload" => max_payload
        }

        body = "0" <> Jason.encode!(handshake)

        conn
        |> Plug.Conn.put_resp_content_type("text/plain; charset=UTF-8")
        |> send_resp(200, body)

      "POST" ->
        conn
        |> Plug.Conn.put_resp_content_type("text/plain; charset=UTF-8")
        |> send_resp(200, "ok")

      "OPTIONS" ->
        send_resp(conn, 204, "")

      _ ->
        send_resp(conn, 405, "Method Not Allowed")
    end
  end
end
