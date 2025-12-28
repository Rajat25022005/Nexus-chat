import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext.tsx"
import AuthLayout from "../components/AuthCard"
import { Link } from "react-router-dom"

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export default function Login() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleLogin = async () => {
    if (!isValidEmail(email)) {
      setError("Please enter a valid email address")
      return
    }

    setError("")
    setLoading(true)

    // simulate network delay
    setTimeout(() => {
      login(email)
      navigate("/chat")
    }, 800)
  }

  return (
    <AuthLayout title="Login" subtitle="Welcome back">
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Your email address"
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
        disabled={loading || !email}
        className="
          w-full rounded-lg bg-nexus-primary py-3 font-medium
          hover:opacity-90 transition
          disabled:opacity-50
        "
      >
        {loading ? "Signing in…" : "Continue"}
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
