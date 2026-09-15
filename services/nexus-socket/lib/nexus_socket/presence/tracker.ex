defmodule NexusSocket.Presence.Tracker do
  @moduledoc """
  Distributed presence tracking using `Phoenix.Tracker` (Delta-CRDTs).

  Provides cluster-wide user presence tracking across `chat:<chat_id>` and `workspace:<id>`
  without database or Redis bottlenecks. Resolves network partitions and concurrent
  join/leave events via join-semilattice CRDTs.
  """

  @behaviour Phoenix.Tracker

  @doc """
  Returns a child specification for starting the tracker under a supervisor.
  """
  def child_spec(opts) do
    %{
      id: __MODULE__,
      start: {__MODULE__, :start_link, [opts]},
      type: :worker,
      restart: :permanent,
      shutdown: 5000
    }
  end

  @doc """
  Starts the presence tracker process.
  """
  def start_link(opts \\ []) do
    opts =
      opts
      |> Keyword.put_new(:name, __MODULE__)
      |> Keyword.put_new(:pubsub_server, NexusSocket.PubSub)

    Phoenix.Tracker.start_link(__MODULE__, opts, opts)
  end

  @doc """
  Tracks the presence of a user process in a given topic.
  """
  @spec track(pid(), String.t(), String.t(), map()) :: {:ok, binary()} | {:error, term()}
  def track(pid, topic, key, meta) do
    Phoenix.Tracker.track(__MODULE__, pid, topic, key, meta)
  end

  @doc """
  Untracks the presence of a user process in a given topic.
  """
  @spec untrack(pid(), String.t(), String.t()) :: :ok | {:error, term()}
  def untrack(pid, topic, key) do
    Phoenix.Tracker.untrack(__MODULE__, pid, topic, key)
  end

  @doc """
  Lists raw `{key, meta}` presences for a topic.
  """
  @spec list(String.t()) :: [{String.t(), map()}]
  def list(topic) do
    Phoenix.Tracker.list(__MODULE__, topic)
  end

  @doc """
  Returns a normalized list of online users for a topic matching the client schema:
  `[%{uid: string(), name: string(), email: string()}]`.
  """
  @spec list_online(String.t()) :: [map()]
  def list_online(topic) do
    Phoenix.Tracker.list(__MODULE__, topic)
    |> Enum.map(fn {key, meta} ->
      %{
        uid: to_string(key),
        name: Map.get(meta, :name, Map.get(meta, "name", "")),
        email: Map.get(meta, :email, Map.get(meta, "email", ""))
      }
    end)
  end

  # --- Phoenix.Tracker Callbacks ---

  @impl Phoenix.Tracker
  def init(opts) do
    server = Keyword.fetch!(opts, :pubsub_server)
    {:ok, %{pubsub_server: server}}
  end

  @impl Phoenix.Tracker
  def handle_diff(diff, state) do
    for {topic, {joins, leaves}} <- diff do
      for {key, meta} <- joins do
        payload = %{
          userId: to_string(key),
          name: Map.get(meta, :name, Map.get(meta, "name", "")),
          email: Map.get(meta, :email, Map.get(meta, "email", ""))
        }

        Phoenix.PubSub.broadcast(
          state.pubsub_server,
          topic,
          {:presence_joined, topic, payload}
        )
      end

      for {key, meta} <- leaves do
        payload = %{
          userId: to_string(key),
          name: Map.get(meta, :name, Map.get(meta, "name", "")),
          email: Map.get(meta, :email, Map.get(meta, "email", ""))
        }

        Phoenix.PubSub.broadcast(
          state.pubsub_server,
          topic,
          {:presence_left, topic, payload}
        )
      end
    end

    {:ok, state}
  end
end
