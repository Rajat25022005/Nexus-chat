defmodule NexusSocket.AuthTest do
  use ExUnit.Case, async: false
  alias NexusSocket.Auth.Jwt
  alias NexusSocket.Auth.Cache

  setup do
    Cache.clear()
    :ok
  end

  describe "JWT Auth Verification (F4)" do
    test "signs and verifies valid JWT token with user_id and email" do
      claims = %{
        "user_id" => "user-uuid-1234",
        "email" => "alex@example.com"
      }

      assert {:ok, token} = Jwt.sign(claims, 3600)
      assert {:ok, verified_claims} = Jwt.verify(token)
      assert verified_claims["user_id"] == "user-uuid-1234"
      assert verified_claims["email"] == "alex@example.com"
      assert is_integer(verified_claims["exp"])
    end

    test "rejects expired token" do
      now = System.system_time(:second)

      claims = %{
        "user_id" => "user-uuid-999",
        "email" => "expired@example.com",
        "exp" => now - 100
      }

      assert {:ok, token} = Jwt.sign(claims, -100)
      assert {:error, :token_expired} = Jwt.verify(token)
    end

    test "rejects token with missing required claims" do
      # Missing email
      claims_no_email = %{"user_id" => "u-1"}
      assert {:ok, token1} = Jwt.sign(claims_no_email, 3600)
      assert {:error, :missing_required_claims} = Jwt.verify(token1)

      # Missing user_id
      claims_no_uid = %{"email" => "e@example.com"}
      assert {:ok, token2} = Jwt.sign(claims_no_uid, 3600)
      assert {:error, :missing_required_claims} = Jwt.verify(token2)
    end

    test "rejects token with invalid signature or tampering" do
      claims = %{"user_id" => "u-1", "email" => "u@test.com"}
      {:ok, token} = Jwt.sign(claims, 3600)

      # Tamper with signature
      tampered = token <> "tampered"
      assert {:error, _} = Jwt.verify(tampered)
    end

    test "rejects malformed token strings" do
      assert {:error, :invalid_token_format} = Jwt.verify("")
      assert {:error, :invalid_token_format} = Jwt.verify(nil)
      assert {:error, _} = Jwt.verify("not.a.valid.jwt")
    end
  end

  describe "In-Memory ETS Cache & TTL Eviction (F5)" do
    test "stores and retrieves token claims from ETS table" do
      token = "test-token-string-123"
      claims = %{"user_id" => "user-1", "email" => "u1@test.com"}
      exp = System.system_time(:second) + 3600

      assert :miss = Cache.lookup(token)
      assert :ok = Cache.put(token, claims, exp)
      assert {:ok, cached} = Cache.lookup(token)
      assert cached == claims
    end

    test "authenticate/1 caches token on first call and hits cache on subsequent calls" do
      claims = %{"user_id" => "cached-user-1", "email" => "cache@test.com"}
      {:ok, token} = Jwt.sign(claims, 3600)

      # Initial state: not cached
      assert Cache.count() == 0

      # First call: verifies and puts into cache
      assert {:ok, c1} = Cache.authenticate(token)
      assert c1["user_id"] == "cached-user-1"
      assert Cache.count() == 1

      # Second call: served directly from ETS cache
      assert {:ok, c2} = Cache.authenticate(token)
      assert c2 == c1
      assert Cache.count() == 1
    end

    test "lookup/1 lazily evicts expired token" do
      token = "expired-token-lazy"
      claims = %{"user_id" => "u-exp", "email" => "exp@test.com"}
      past_exp = System.system_time(:second) - 10

      Cache.put(token, claims, past_exp)
      assert Cache.count() == 1

      # Lookup should notice expiration, delete from ETS, and return :miss
      assert :miss = Cache.lookup(token)
      assert Cache.count() == 0
    end

    test "sweep_expired/0 atomically deletes all expired entries" do
      now = System.system_time(:second)

      # Insert 3 expired tokens
      Cache.put("exp-1", %{"user_id" => "1"}, now - 50)
      Cache.put("exp-2", %{"user_id" => "2"}, now - 20)
      Cache.put("exp-3", %{"user_id" => "3"}, now - 5)

      # Insert 2 valid tokens
      Cache.put("val-1", %{"user_id" => "4"}, now + 500)
      Cache.put("val-2", %{"user_id" => "5"}, now + 1000)

      assert Cache.count() == 5

      # Run atomic TTL sweep
      deleted = Cache.sweep_expired()
      assert deleted == 3
      assert Cache.count() == 2

      # Confirm remaining entries are the valid ones
      assert {:ok, _} = Cache.lookup("val-1")
      assert {:ok, _} = Cache.lookup("val-2")
      assert :miss = Cache.lookup("exp-1")
    end

    test "handles concurrent ETS reads without race conditions" do
      token = "concurrent-token"
      claims = %{"user_id" => "u-conc", "email" => "conc@test.com"}
      Cache.put(token, claims, System.system_time(:second) + 3600)

      # Spawn 20 concurrent processes looking up the same token
      tasks =
        for _ <- 1..20 do
          Task.async(fn ->
            Cache.lookup(token)
          end)
        end

      results = Task.await_many(tasks)
      Enum.each(results, fn res ->
        assert {:ok, ^claims} = res
      end)
    end
  end

  describe "SEC-03: Strict JWT Secret Enforcement in Production" do
    test "config/runtime.exs raises error when config_env is :prod and JWT_SECRET is missing" do
      runtime_path = Path.expand("../../config/runtime.exs", __DIR__)
      orig_secret = System.get_env("JWT_SECRET")
      System.delete_env("JWT_SECRET")

      assert_raise RuntimeError, ~r/Environment variable JWT_SECRET is missing/, fn ->
        Config.Reader.read!(runtime_path, env: :prod)
      end

      if orig_secret, do: System.put_env("JWT_SECRET", orig_secret)
    end

    test "config/runtime.exs accepts JWT_SECRET in :prod when set" do
      runtime_path = Path.expand("../../config/runtime.exs", __DIR__)
      orig_secret = System.get_env("JWT_SECRET")
      System.put_env("JWT_SECRET", "prod-secret-key-12345678901234567890")

      cfg = Config.Reader.read!(runtime_path, env: :prod)
      assert get_in(cfg, [:nexus_socket, :jwt_secret]) == "prod-secret-key-12345678901234567890"

      if orig_secret, do: System.put_env("JWT_SECRET", orig_secret), else: System.delete_env("JWT_SECRET")
    end

    test "config/runtime.exs falls back to supersecret-dev-key in :dev and :test when unset" do
      runtime_path = Path.expand("../../config/runtime.exs", __DIR__)
      orig_secret = System.get_env("JWT_SECRET")
      System.delete_env("JWT_SECRET")

      cfg_dev = Config.Reader.read!(runtime_path, env: :dev)
      assert get_in(cfg_dev, [:nexus_socket, :jwt_secret]) == "supersecret-dev-key"

      cfg_test = Config.Reader.read!(runtime_path, env: :test)
      assert get_in(cfg_test, [:nexus_socket, :jwt_secret]) == "supersecret-dev-key"

      if orig_secret, do: System.put_env("JWT_SECRET", orig_secret)
    end
  end
end
