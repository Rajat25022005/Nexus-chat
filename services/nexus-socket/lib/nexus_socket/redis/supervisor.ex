defmodule NexusSocket.Redis.Supervisor do
  @moduledoc """
  Supervisor managing Redis Subscriber and Publisher processes.
  Uses `:one_for_one` strategy so a crash in either connection does not impact the other.
  """

  use Supervisor

  def start_link(opts \\ []) do
    Supervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(opts) do
    children = [
      {NexusSocket.Redis.Subscriber, opts},
      {NexusSocket.Redis.Publisher, opts}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end
end
