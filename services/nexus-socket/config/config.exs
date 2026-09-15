import Config

config :nexus_socket,
  port: 3001,
  jwt_secret: "supersecret-dev-key",
  ping_interval: 25_000,
  ping_timeout: 20_000,
  max_payload: 1_000_000,
  ai_stream_flush_interval_ms: 25,
  ai_stream_max_buffer_chars: 48,
  redis_url: "redis://localhost:6379"

config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

import_config "#{config_env()}.exs"
