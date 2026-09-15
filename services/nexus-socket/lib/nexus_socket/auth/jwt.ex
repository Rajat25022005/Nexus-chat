defmodule NexusSocket.Auth.Jwt do
  @moduledoc """
  HS256 JWT verification and token claim extractor.

  Verifies JWT signatures against `JWT_SECRET` (defaults to `"supersecret-dev-key"`)
  and validates mandatory claims (`user_id`, `email`, `exp`).
  """

  @default_secret "supersecret-dev-key"

  @doc """
  Returns the configured JWT secret.
  """
  @spec secret() :: String.t()
  def secret do
    Application.get_env(:nexus_socket, :jwt_secret) ||
      System.get_env("JWT_SECRET") ||
      @default_secret
  end

  @doc """
  Verifies a JWT string against the secret and validates claims.
  Returns `{:ok, claims}` or `{:error, reason}`.
  """
  @spec verify(String.t()) :: {:ok, map()} | {:error, term()}
  def verify(token) when is_binary(token) and byte_size(token) > 0 do
    signer = Joken.Signer.create("HS256", secret())

    case Joken.Signer.verify(token, signer) do
      {:ok, claims} ->
        validate_claims(claims)

      {:error, reason} ->
        {:error, reason}
    end
  end

  def verify(_), do: {:error, :invalid_token_format}

  @doc """
  Generates a signed JWT token with the given claims (useful for testing and internal service calls).
  """
  @spec sign(map(), integer()) :: {:ok, String.t()} | {:error, term()}
  def sign(claims, ttl_seconds \\ 3600) when is_map(claims) do
    now = System.system_time(:second)
    exp = Map.get(claims, "exp", now + ttl_seconds)

    full_claims =
      claims
      |> Map.put_new("iat", now)
      |> Map.put("exp", exp)

    signer = Joken.Signer.create("HS256", secret())

    case Joken.Signer.sign(full_claims, signer) do
      {:ok, token} -> {:ok, token}
      {:error, reason} -> {:error, reason}
    end
  end

  # --- Internal Validations ---

  defp validate_claims(%{"user_id" => uid, "email" => email, "exp" => exp} = claims)
       when is_binary(uid) and byte_size(uid) > 0 and
              is_binary(email) and byte_size(email) > 0 and
              is_integer(exp) do
    now = System.system_time(:second)

    if exp > now do
      {:ok, claims}
    else
      {:error, :token_expired}
    end
  end

  defp validate_claims(%{"exp" => exp}) when is_integer(exp) do
    now = System.system_time(:second)

    if exp <= now do
      {:error, :token_expired}
    else
      {:error, :missing_required_claims}
    end
  end

  defp validate_claims(_claims) do
    {:error, :missing_required_claims}
  end
end
