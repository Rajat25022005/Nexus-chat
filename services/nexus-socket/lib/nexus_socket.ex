defmodule NexusSocket do
  @moduledoc """
  NexusSocket: High-performance, fault-tolerant Elixir/OTP Socket.IO v4 real-time service.
  """

  @doc """
  Returns the current version of the NexusSocket service.
  """
  @spec version() :: String.t()
  def version do
    "0.1.0"
  end
end
