defmodule NexusSocket.Application do
  @moduledoc """
  NexusSocket OTP Application and root `:rest_for_one` supervision tree.

  Supervision hierarchy guarantees strict dependency initialization order:
  1. NexusSocket.Telemetry
  2. NexusSocket.Auth.Cache (ETS table owner + periodic TTL sweeper)
  3. Phoenix.PubSub (cluster-wide messaging backend)
  4. NexusSocket.Presence.Tracker (Phoenix.Tracker Delta-CRDTs)
  5. NexusSocket.AiStreamBuffer (adaptive micro-batching GenServer)
  6. PartitionSupervisor (connection process isolation across CPU schedulers)
  7. Bandit HTTP & WebSocket acceptor pool
  """

  use Application
  require Logger

  @impl true
  def start(_type, _args) do
    port = Application.get_env(:nexus_socket, :port, 3001)

    children = [
      # 1. Telemetry & VM Poller
      NexusSocket.Telemetry,

      # 2. JWT Cache & ETS Owner with TTL Sweeper
      NexusSocket.Auth.Cache,

      # 3. Distributed PubSub using BEAM process groups (:pg)
      {Phoenix.PubSub, name: NexusSocket.PubSub},

      # 4. Delta-CRDT Presence Tracker
      NexusSocket.Presence.Tracker,

      # 5. Soft real-time AI token streaming buffer
      NexusSocket.AiStreamBuffer,

      # 6. Redis Pub/Sub Subscriber & Publisher Bridge
      NexusSocket.Redis.Supervisor,

      # 7. Dynamic partition supervisor for connection crash isolation
      {PartitionSupervisor,
       child_spec: DynamicSupervisor,
       name: NexusSocket.ConnectionSupervisor},

      # 8. Bandit HTTP & WebSocket server
      {Bandit,
       plug: NexusSocket.Endpoint,
       scheme: :http,
       port: port,
       ip: {0, 0, 0, 0}}
    ]

    opts = [strategy: :rest_for_one, name: NexusSocket.Supervisor]
    Logger.info("NexusSocket application starting on port #{port} with :rest_for_one supervision")
    Supervisor.start_link(children, opts)
  end
end
