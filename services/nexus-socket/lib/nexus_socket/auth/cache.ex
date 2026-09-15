defmodule NexusSocket.Auth.Cache do
  @moduledoc """
  In-memory ETS cache for JWT tokens with atomic TTL sweep and heir resilience.

  Caches verified user claims to prevent database query or cryptographic verification
  exhaustion during connection bursts.
  Table schema: `{token_sha256, user_claims, expires_at_unix}`.
  """

  use GenServer
  require Logger

  @table_name :nexus_jwt_cache
  @default_sweep_interval_ms 60_000

  # --- Client API ---

  @doc """
  Starts the ETS cache owner GenServer.
  """
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Authenticates a token by first checking the ETS cache, and on miss verifying the signature
  and caching the result until its expiration.
  """
  @spec authenticate(String.t()) :: {:ok, map()} | {:error, term()}
  def authenticate(token) when is_binary(token) do
    case lookup(token) do
      {:ok, claims} ->
        {:ok, claims}

      :miss ->
        case NexusSocket.Auth.Jwt.verify(token) do
          {:ok, claims} ->
            exp = Map.get(claims, "exp")
            put(token, claims, exp)
            {:ok, claims}

          {:error, reason} ->
            {:error, reason}
        end
    end
  end

  def authenticate(_), do: {:error, :invalid_token}

  @doc """
  Looks up a token's claims in the ETS table.
  Direct concurrent RAM read via `:ets.lookup/2` bypassing the GenServer mailbox.
  """
  @spec lookup(String.t()) :: {:ok, map()} | :miss
  def lookup(token) when is_binary(token) do
    token_hash = hash_token(token)

    try do
      case :ets.lookup(@table_name, token_hash) do
        [{^token_hash, claims, exp}] ->
          now = System.system_time(:second)

          if exp > now do
            {:ok, claims}
          else
            # Lazy delete expired entry
            :ets.delete(@table_name, token_hash)
            :miss
          end

        [] ->
          :miss
      end
    catch
      :error, :badarg ->
        # Table might not exist yet if called before start
        :miss
    end
  end

  @doc """
  Inserts token claims into the ETS table with an expiration timestamp.
  """
  @spec put(String.t(), map(), integer()) :: :ok
  def put(token, claims, expires_at_unix)
      when is_binary(token) and is_map(claims) and is_integer(expires_at_unix) do
    token_hash = hash_token(token)

    try do
      :ets.insert(@table_name, {token_hash, claims, expires_at_unix})
      :ok
    catch
      :error, :badarg ->
        :ok
    end
  end

  @doc """
  Performs an atomic TTL sweep of expired entries in the ETS table using `:ets.select_delete/2`.
  Returns the count of deleted records.
  """
  @spec sweep_expired() :: integer()
  def sweep_expired do
    now = System.system_time(:second)
    # Match spec: [{{token_hash, claims, exp}, [exp =< now], [true]}]
    match_spec = [{{:"$1", :_, :"$2"}, [{:"=<", :"$2", now}], [true]}]

    try do
      :ets.select_delete(@table_name, match_spec)
    catch
      :error, :badarg -> 0
    end
  end

  @doc """
  Returns the total count of cached tokens in the ETS table.
  """
  @spec count() :: integer()
  def count do
    try do
      :ets.info(@table_name, :size) || 0
    catch
      :error, :badarg -> 0
    end
  end

  @doc """
  Clears all cached tokens from the ETS table.
  """
  @spec clear() :: :ok
  def clear do
    try do
      :ets.delete_all_objects(@table_name)
      :ok
    catch
      :error, :badarg -> :ok
    end
  end

  # --- GenServer Callbacks ---

  @impl true
  def init(opts) do
    sweep_interval = Keyword.get(opts, :sweep_interval_ms, @default_sweep_interval_ms)
    heir_pid = NexusSocket.Auth.Cache.Heir.ensure_started()

    # Check if table already exists (e.g. if handed back from heir or restarted)
    case :ets.whereis(@table_name) do
      :undefined ->
        :ets.new(@table_name, [
          :set,
          :public,
          :named_table,
          {:read_concurrency, true},
          {:write_concurrency, true},
          {:heir, heir_pid, :cache_heir}
        ])

      _tid ->
        # Table survived crash via heir; reclaim table ownership
        GenServer.call(heir_pid, {:give_back, self()})

        try do
          :ets.setopts(@table_name, {:heir, heir_pid, :cache_heir})
        catch
          :error, _ -> :ok
        end

        :ok
    end

    schedule_sweep(sweep_interval)
    {:ok, %{sweep_interval_ms: sweep_interval, heir_pid: heir_pid}}
  end

  @impl true
  def handle_info(:sweep, state) do
    deleted = sweep_expired()

    if deleted > 0 do
      Logger.debug("NexusSocket.Auth.Cache: Evicted #{deleted} expired JWT tokens")
    end

    schedule_sweep(state.sweep_interval_ms)
    {:noreply, state}
  end

  @impl true
  def handle_info({:"ETS-TRANSFER", table, _from_pid, _data}, state) do
    Logger.info("NexusSocket.Auth.Cache: Inherited ETS table #{inspect(table)}")
    heir_pid = Process.whereis(NexusSocket.Auth.Cache.Heir) || state.heir_pid

    if heir_pid && Process.alive?(heir_pid) do
      try do
        :ets.setopts(table, {:heir, heir_pid, :cache_heir})
      catch
        :error, _ -> :ok
      end
    end

    {:noreply, state}
  end

  # --- Private Helpers ---

  defp schedule_sweep(interval) when is_integer(interval) and interval > 0 do
    Process.send_after(self(), :sweep, interval)
  end

  defp hash_token(token) do
    :crypto.hash(:sha256, token)
  end
end

defmodule NexusSocket.Auth.Cache.Heir do
  @moduledoc """
  Lightweight companion process acting as ETS table heir for `:nexus_jwt_cache`.
  Holds the table in memory if `NexusSocket.Auth.Cache` crashes, and returns ownership
  to the newly restarted Cache GenServer.
  """

  use GenServer
  require Logger

  @doc """
  Starts the Heir process linked.
  """
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Ensures the Heir process is alive and returns its PID.
  Uses unlinked start so owner crashes cannot take down the heir.
  """
  def ensure_started do
    case Process.whereis(__MODULE__) do
      pid when is_pid(pid) ->
        if Process.alive?(pid), do: pid, else: spawn_heir()

      nil ->
        spawn_heir()
    end
  end

  defp spawn_heir do
    case GenServer.start(__MODULE__, [], name: __MODULE__) do
      {:ok, pid} -> pid
      {:error, {:already_started, pid}} -> pid
    end
  end

  @impl true
  def init(_opts) do
    Process.flag(:trap_exit, true)
    {:ok, %{table: nil}}
  end

  @impl true
  def handle_call({:give_back, target_pid}, _from, state) do
    if state.table do
      try do
        :ets.give_away(state.table, target_pid, :returned_to_owner)
        {:reply, :ok, %{state | table: nil}}
      catch
        :error, _ ->
          {:reply, :error, state}
      end
    else
      {:reply, :ok, state}
    end
  end

  @impl true
  def handle_info({:"ETS-TRANSFER", table, from_pid, data}, state) do
    Logger.info(
      "NexusSocket.Auth.Cache.Heir: Received ETS table #{inspect(table)} from #{inspect(from_pid)} (#{inspect(data)})"
    )

    {:noreply, %{state | table: table}}
  end

  @impl true
  def handle_info({:EXIT, _from, _reason}, state) do
    {:noreply, state}
  end

  @impl true
  def handle_info(_other, state) do
    {:noreply, state}
  end
end
