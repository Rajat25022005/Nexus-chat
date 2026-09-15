defmodule NexusSocket.Channels.ChatChannel do
  @moduledoc """
  Topic multiplexing and channel broadcast coordinator for rooms, workspaces, and groups.
  """

  @doc """
  Constructs a standard chat room topic string.
  """
  @spec chat_topic(String.t()) :: String.t()
  def chat_topic(chat_id), do: "chat:#{chat_id}"

  @doc """
  Constructs a standard group room topic string.
  """
  @spec group_topic(String.t()) :: String.t()
  def group_topic(group_id), do: "group:#{group_id}"

  @doc """
  Constructs a standard workspace topic string.
  """
  @spec workspace_topic(String.t()) :: String.t()
  def workspace_topic(workspace_id), do: "workspace:#{workspace_id}"

  @doc """
  Broadcasts an event to all subscribers in a chat room.
  """
  @spec broadcast_chat(String.t(), String.t(), map()) :: :ok | {:error, term()}
  def broadcast_chat(chat_id, event, payload) do
    Phoenix.PubSub.broadcast(
      NexusSocket.PubSub,
      chat_topic(chat_id),
      {:socket_broadcast, event, payload}
    )
  end

  @doc """
  Broadcasts an event to all subscribers in a workspace.
  """
  @spec broadcast_workspace(String.t(), String.t(), map()) :: :ok | {:error, term()}
  def broadcast_workspace(workspace_id, event, payload) do
    Phoenix.PubSub.broadcast(
      NexusSocket.PubSub,
      workspace_topic(workspace_id),
      {:socket_broadcast, event, payload}
    )
  end
end
