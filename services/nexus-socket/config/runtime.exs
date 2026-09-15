import Config

if System.get_env("PORT") do
  config :nexus_socket, port: String.to_integer(System.get_env("PORT"))
end

if config_env() == :prod do
  jwt_secret =
    System.get_env("JWT_SECRET") ||
      raise """
      Environment variable JWT_SECRET is missing.
      You must set JWT_SECRET in production for secure token verification.
      """

  config :nexus_socket, jwt_secret: jwt_secret
else
  jwt_secret = System.get_env("JWT_SECRET") || "supersecret-dev-key"
  config :nexus_socket, jwt_secret: jwt_secret
end

if System.get_env("REDIS_URL") do
  config :nexus_socket, redis_url: System.get_env("REDIS_URL")
end
