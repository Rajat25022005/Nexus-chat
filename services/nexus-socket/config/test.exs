import Config

config :nexus_socket,
  port: 4002,
  jwt_secret: "supersecret-dev-key",
  ping_interval: 1_000,
  ping_timeout: 500,
  ai_stream_flush_interval_ms: 10,
  ai_stream_max_buffer_chars: 20,
  redis_url: "disabled"

config :logger, level: :warning
