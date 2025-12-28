import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext.tsx"
import AuthLayout from "../components/AuthCard"
import { Link } from "react-router-dom"

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export default function Signup() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSignup = () => {
    if (!name.trim()) {
      setError("Please enter your name")
      return
    }

    if (!isValidEmail(email)) {
      setError("Please enter a valid email address")
      return
    }

    setError("")
    setLoading(true)

    setTimeout(() => {
      login(email)
      navigate("/chat")
    }, 800)
  }

  return (
    <AuthLayout title="Create account" subtitle="Start your Nexus workspace">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
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

      {error && (
        <p className="mb-3 text-sm text-red-400">{error}</p>
      )}

      <button
        onClick={handleSignup}
        disabled={loading}
        className="
          w-full rounded-lg bg-nexus-primary py-3 font-medium
          hover:opacity-90 transition
          disabled:opacity-50
        "
      >
        {loading ? "Creating account…" : "Create account"}
      </button>
      <p className="mt-6 text-center text-sm text-nexus-muted">
        Already have an account?{" "}
        <Link
          to="/login"
          className="text-nexus-primary hover:underline"
        >
          Login
        </Link>
      </p>

    </AuthLayout>
  )
}
