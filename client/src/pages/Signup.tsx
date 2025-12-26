import AuthLayout from "../components/AuthCard"
import { Link } from "react-router-dom"

export default function Signup() {
  return (
    <AuthLayout title="Create account" subtitle="Start your Nexus workspace">

      <input
        type="text"
        placeholder="Your name"
        className="mb-3 w-full rounded-lg bg-transparent border border-nexus-deep
                   px-4 py-3 text-sm text-nexus-text placeholder-nexus-muted
                   outline-none focus:ring-2 focus:ring-nexus-primary"
      />

      <input
        type="email"
        placeholder="Email address"
        className="mb-4 w-full rounded-lg bg-transparent border border-nexus-deep
                   px-4 py-3 text-sm text-nexus-text placeholder-nexus-muted
                   outline-none focus:ring-2 focus:ring-nexus-primary"
      />

      <button
        className="w-full rounded-lg bg-nexus-primary py-3 font-medium
                   hover:bg-nexus-primaryHover transition"
      >
        Create account
      </button>

      <p className="mt-6 text-center text-sm text-nexus-muted">
        Already have an account?{" "}
        <Link to="/login" className="text-nexus-primary hover:underline">
          Login
        </Link>

      </p>

    </AuthLayout>
  )
}
