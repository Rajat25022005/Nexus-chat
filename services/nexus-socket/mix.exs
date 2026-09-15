defmodule NexusSocket.MixProject do
  use Mix.Project

  def project do
    [
      app: :nexus_socket,
      version: "0.1.0",
      elixir: "~> 1.14",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      aliases: aliases(),
      deps: deps()
    ]
  end

  def application do
    [
      extra_applications: [:logger, :runtime_tools, :crypto],
      mod: {NexusSocket.Application, []}
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp deps do
    [
      {:bandit, "~> 1.5"},
      {:websock, "~> 0.5"},
      {:websock_adapter, "~> 0.5"},
      {:plug, "~> 1.16"},
      {:cors_plug, "~> 3.0"},
      {:phoenix, "~> 1.7.14"},
      {:phoenix_pubsub, "~> 2.1"},
      {:jason, "~> 1.4"},
      {:joken, "~> 2.6"},
      {:telemetry, "~> 1.2"},
      {:telemetry_poller, "~> 1.1"},
      {:telemetry_metrics, "~> 1.0"}
    ]
  end

  defp aliases do
    [
      setup: ["deps.get", "compile"],
      test: ["test"]
    ]
  end
end
