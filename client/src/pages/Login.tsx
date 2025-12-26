import AuthLayout from "../components/AuthCard"
import SocialButton from "../components/SocialButton"
import { FaGoogle, FaApple, FaDiscord } from "react-icons/fa"
import { Link } from "react-router-dom"


export default function Login() {
  return (
    <AuthLayout title="Login" subtitle="Welcome back">

      <input
        type="email"
        placeholder="Your email address"
        className="mb-4 w-full rounded-lg bg-transparent border border-nexus-deep
                   px-4 py-3 text-sm text-nexus-text placeholder-nexus-muted
                   outline-none focus:ring-2 focus:ring-nexus-primary"
      />

      <button
        className="mb-6 w-full rounded-lg bg-nexus-primary py-3 font-medium
                   hover:bg-nexus-primaryHover transition"
      >
        Continue
      </button>

      <div className="my-6 flex items-center gap-3 text-nexus-muted text-sm">
        <div className="h-px flex-1 bg-nexus-divider" />
        OR
        <div className="h-px flex-1 bg-nexus-divider" />
      </div>

      <div className="space-y-3">
        <SocialButton icon={<FaGoogle />} text="Continue with Google" />
        <SocialButton icon={<FaApple />} text="Continue with Apple" />
        <SocialButton icon={<FaDiscord />} text="Continue with Discord" />
      </div>

      <p className="mt-6 text-center text-sm text-nexus-muted">
        Don’t have an account?{" "}
        <Link to="/signup" className="text-nexus-primary hover:underline">
          Sign up
        </Link>

      </p>

    </AuthLayout>
  )
}
