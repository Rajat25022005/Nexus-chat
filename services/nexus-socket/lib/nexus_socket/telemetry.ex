defmodule NexusSocket.Telemetry do
  @moduledoc """
  Telemetry supervisor and metrics configuration.
  """

  use Supervisor
  import Telemetry.Metrics

  def start_link(arg) do
    Supervisor.start_link(__MODULE__, arg, name: __MODULE__)
  end

  @impl true
  def init(_arg) do
    children = [
      {:telemetry_poller, measurements: periodic_measurements(), period: 10_000}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end

  def metrics do
    [
      # VM Metrics
      last_value("vm.memory.total", unit: {:byte, :megabyte}),
      last_value("vm.total_run_queue_lengths.total"),
      last_value("vm.total_run_queue_lengths.cpu"),
      last_value("vm.system_counts.process_count")
    ]
  end

  defp periodic_measurements do
    [
      {__MODULE__, :measure_vm, []}
    ]
  end

  @doc false
  def measure_vm do
    :telemetry.execute([:vm, :memory], %{total: :erlang.memory(:total)})
  end
end
