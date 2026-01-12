import { useState } from "react"
import { useNavigate, Link } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import AuthLayout from "../components/AuthCard"

import { API_URL } from "../api/config"

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export default function Login() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const { login } = useAuth()
  const navigate = useNavigate()

  const handleLogin = async () => {
    if (!isValidEmail(email)) {
      setError("Please enter a valid email address")
      return
    }
    if (!password) {
      setError("Please enter your password")
      return
    }

    setError("")
    setLoading(true)

    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password }),
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.detail || "Invalid credentials")
      }

      const data = await res.json()

      login(data.access_token)

      navigate("/chat")
    } catch (err: unknown) {
      console.error(err)
      if (err instanceof Error) {
        setError(err.message || "Login failed. Please try again.")
      } else {
        setError("Login failed. Please try again.")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="Login" subtitle="Welcome back">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email address"
        className="
          mb-3 w-full rounded-lg
          bg-nexus-input text-nexus-text
          border border-nexus-border
          px-4 py-3 text-sm
          placeholder:text-nexus-muted
          outline-none
          focus:border-nexus-primary
        "
      />

      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="
          mb-3 w-full rounded-lg
          bg-nexus-input text-nexus-text
          border border-nexus-border
          px-4 py-3 text-sm
          placeholder:text-nexus-muted
          outline-none
          focus:border-nexus-primary
        "
      />

      {error && (
        <p className="mb-3 text-sm text-red-400">{error}</p>
      )}

      <button
        onClick={handleLogin}
        disabled={loading || !email || !password}
        className="
          w-full rounded-lg bg-nexus-primary py-3 font-medium
          hover:opacity-90 transition
          disabled:opacity-50
          disabled:cursor-not-allowed
        "
      >
        {loading ? "Signing in…" : "Login"}
      </button>

      <p className="mt-6 text-center text-sm text-nexus-muted">
        Don’t have an account?{" "}
        <Link
          to="/signup"
          className="text-nexus-primary hover:underline"
        >
          Sign up
        </Link>
      </p>
    </AuthLayout>
  )
}