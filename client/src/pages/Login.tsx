import { useState } from "react"
import { useNavigate, Link } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import AuthLayout from "../components/AuthCard"
import Modal from "../components/Modal"

import { API_URL } from "../api/config"



export default function Login() {
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const { login } = useAuth()
  const navigate = useNavigate()

  // Reset Password State
  const [showResetModal, setShowResetModal] = useState(false)
  const [resetState, setResetState] = useState<"email" | "otp" | "password">("email")
  const [resetEmail, setResetEmail] = useState("")
  const [resetOtp, setResetOtp] = useState("")
  const [resetToken, setResetToken] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [resetError, setResetError] = useState("")
  const [resetLoading, setResetLoading] = useState(false)

  const handleRequestResetOtp = async () => {
    try {
      setResetLoading(true)
      setResetError("")
      const res = await fetch(`${API_URL}/auth/request-reset-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail })
      })
      if (!res.ok) throw new Error((await res.json()).detail || "Failed to send code")
      setResetState("otp")
    } catch (e: any) {
      setResetError(e.message)
    } finally {
      setResetLoading(false)
    }
  }

  const handleVerifyResetOtp = async () => {
    try {
      setResetLoading(true)
      setResetError("")
      const res = await fetch(`${API_URL}/auth/verify-reset-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail, otp: resetOtp })
      })
      if (!res.ok) throw new Error((await res.json()).detail || "Invalid code")
      const data = await res.json()
      setResetToken(data.reset_token)
      setResetState("password")
    } catch (e: any) {
      setResetError(e.message)
    } finally {
      setResetLoading(false)
    }
  }

  const handleResetPassword = async () => {
    try {
      setResetLoading(true)
      setResetError("")
      if (newPassword.length < 6) throw new Error("Password too short")

      const res = await fetch(`${API_URL}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset_token: resetToken, new_password: newPassword })
      })
      if (!res.ok) throw new Error((await res.json()).detail || "Failed to reset")

      alert("Password reset successfully! Please login.")
      setShowResetModal(false)
      setIdentifier(resetEmail)
      setPassword("")
    } catch (e: any) {
      setResetError(e.message)
    } finally {
      setResetLoading(false)
    }
  }

  const handleLogin = async () => {
    if (!identifier.trim()) {
      setError("Please enter your email or username")
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
        body: JSON.stringify({ identifier, password }),
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
        type="text"
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        placeholder="Email or Username"
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

      <div className="flex justify-end mb-4">
        <button
          onClick={() => {
            setResetState("email")
            setResetEmail("")
            setResetOtp("")
            setNewPassword("")
            setResetError("")
            setShowResetModal(true)
          }}
          className="text-xs text-nexus-primary hover:underline"
        >
          Forgot Password?
        </button>
      </div>

      <button
        onClick={handleLogin}
        disabled={loading || !identifier || !password}
        className="
          w-full rounded-lg bg-nexus-primary py-3 font-medium
          hover:opacity-90 transition
          disabled:opacity-50
          disabled:cursor-not-allowed
        "
      >
        {loading ? "Signing in…" : "Login"}
      </button>

      {/* Divider */}
      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-nexus-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-nexus-card px-2 text-nexus-muted">Or continue with</span>
        </div>
      </div>

      <a
        href={`${API_URL}/auth/login/google`}
        className="
          flex w-full items-center justify-center gap-2 rounded-lg
          border border-nexus-border py-3 font-medium transition
          hover:bg-nexus-hover
        "
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        Google
      </a>

      <p className="mt-6 text-center text-sm text-nexus-muted">
        Don’t have an account?{" "}
        <Link
          to="/signup"
          className="text-nexus-primary hover:underline"
        >
          Sign up
        </Link>
      </p>

      {/* Forgot Password Modal */}
      <Modal
        isOpen={showResetModal}
        onClose={() => setShowResetModal(false)}
        title="Reset Password"
      >
        <div className="space-y-4">
          {resetError && <p className="text-sm text-red-400">{resetError}</p>}

          {/* Step 1: Email */}
          {resetState === "email" && (
            <>
              <p className="text-sm text-nexus-muted">Enter your email address to receive a verification code.</p>
              <input
                className="w-full rounded bg-nexus-input px-3 py-2 text-nexus-text border border-nexus-border focus:border-nexus-primary outline-none"
                placeholder="Email Address"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
              />
              <button
                onClick={handleRequestResetOtp}
                disabled={resetLoading}
                className="w-full bg-nexus-primary py-2 rounded font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {resetLoading ? "Sending..." : "Send Code"}
              </button>
            </>
          )}

          {/* Step 2: OTP */}
          {resetState === "otp" && (
            <>
              <p className="text-sm text-nexus-muted">Enter the 6-digit code sent to {resetEmail}</p>
              <input
                className="w-full rounded bg-nexus-input px-3 py-2 text-nexus-text border border-nexus-border focus:border-nexus-primary outline-none text-center tracking-widest"
                placeholder="000000"
                maxLength={6}
                value={resetOtp}
                onChange={(e) => setResetOtp(e.target.value)}
              />
              <button
                onClick={handleVerifyResetOtp}
                disabled={resetLoading}
                className="w-full bg-nexus-primary py-2 rounded font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {resetLoading ? "Verifying..." : "Verify Code"}
              </button>
            </>
          )}

          {/* Step 3: New Password */}
          {resetState === "password" && (
            <>
              <p className="text-sm text-nexus-muted">Enter your new password.</p>
              <input
                type="password"
                className="w-full rounded bg-nexus-input px-3 py-2 text-nexus-text border border-nexus-border focus:border-nexus-primary outline-none"
                placeholder="New Password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <button
                onClick={handleResetPassword}
                disabled={resetLoading}
                className="w-full bg-nexus-primary py-2 rounded font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {resetLoading ? "Resetting..." : "Reset Password"}
              </button>
            </>
          )}
        </div>
      </Modal>
    </AuthLayout>
  )
}
