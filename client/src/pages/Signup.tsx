import { useState } from "react"
import { useNavigate, Link } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import AuthLayout from "../components/AuthCard"

import { API_URL } from "../api/config"

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export default function Signup() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSignup = async () => {
    // Client-side validation
    if (!isValidEmail(email)) {
      setError("Please enter a valid email address")
      return
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters")
      return
    }

    setError("")
    setLoading(true)

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || "https://nexus-backend-453285339762.europe-west1.run.app"}/auth/signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
        }),
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.detail || "Signup failed")
      }

      const data = await res.json()

      // Save JWT + user
      login(data.access_token)

      // Redirect to chat
      navigate("/chat")
    } catch (err: unknown) {
      console.error(err)
      if (err instanceof Error) {
        setError(err.message || "Signup failed")
      } else {
        setError("Signup failed")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="Create account" subtitle="Start your Nexus workspace">
      {/* Email */}
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

      {/* Password */}
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

      {/* Error */}
      {error && (
        <p className="mb-3 text-sm text-red-400">{error}</p>
      )}

      {/* Submit */}
      <button
        onClick={handleSignup}
        disabled={loading}
        className="
          w-full rounded-lg bg-nexus-primary py-3 font-medium
          hover:opacity-90 transition
          disabled:opacity-50 disabled:cursor-not-allowed
        "
      >
        {loading ? "Creating account…" : "Create account"}
      </button>

      {/* Login link */}
      <p className="mt-6 text-center text-sm text-nexus-muted">
        Already have an account?{" "}
        <Link to="/login" className="text-nexus-primary hover:underline">
          Login
        </Link>
      </p>
    </AuthLayout>
  )
}
