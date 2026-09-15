defmodule NexusSocket.Redis do
  @moduledoc """
  Public API for Nexus Redis Pub/Sub integration.

  Provides high-level helpers to publish events and query connection status:
  - `publish(channel, payload)`: Emits raw strings or maps (JSON-encoded) to Redis
  - `connected?()`: Returns whether both subscriber and publisher are connected
  - `status()`: Returns map of connection states and configured URL
  """

  alias NexusSocket.Redis.Publisher
  alias NexusSocket.Redis.Subscriber

  @doc """
  Publishes a message or map to a Redis channel.

  ## Examples

      iex> NexusSocket.Redis.publish("room:123:events", %{type: "user_joined", user_id: "u1"})
      :ok
  """
  @spec publish(binary(), binary() | map() | list()) :: :ok | {:error, term()}
  def publish(channel, payload) do
    Publisher.publish(channel, payload)
  end

  @doc """
  Returns true if the Redis subscriber is connected.
  """
  @spec connected?() :: boolean()
  def connected? do
    Subscriber.connected?() and Publisher.connected?()
  end

  @doc """
  Returns connection details for both subscriber and publisher.
  """
  @spec status() :: %{subscriber: map(), publisher: map()}
  def status do
    %{
      subscriber: Subscriber.status(),
      publisher: Publisher.status()
    }
  end

  @doc """
  Parses a Redis connection string. Delegates to `NexusSocket.Redis.Subscriber.parse_redis_url/1`.
  """
  defdelegate parse_redis_url(url), to: Subscriber
end
