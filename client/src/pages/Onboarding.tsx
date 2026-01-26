import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { updateProfile } from "../api/auth"
import { ArrowRight } from "lucide-react"

export default function Onboarding() {
    const { token, login } = useAuth()
    const navigate = useNavigate()

    const [username, setUsername] = useState("")
    const [fullName, setFullName] = useState("")
    const [bio, setBio] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")
        setLoading(true)

        try {
            if (!token) throw new Error("Not authenticated")

            const data = await updateProfile(token, username, undefined, fullName, bio)

            // Update local auth with new token
            login(data.access_token)

            navigate("/chat")
        } catch (err: unknown) {
            if (err instanceof Error) {
                setError(err.message)
            } else {
                setError("Failed to complete onboarding")
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-nexus-bg text-nexus-text p-4">
            <div className="w-full max-w-md p-8 bg-nexus-card rounded-xl border border-nexus-border shadow-2xl">
                <h1 className="text-3xl font-bold mb-2">Welcome to Nexus!</h1>
                <p className="text-nexus-muted mb-6">Let's set up your profile.</p>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-nexus-muted mb-1">Username</label>
                        <input
                            type="text"
                            required
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full rounded-lg bg-nexus-input border border-nexus-border px-4 py-2 text-nexus-text focus:border-nexus-primary outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-nexus-muted mb-1">Full Name</label>
                        <input
                            type="text"
                            required
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            className="w-full rounded-lg bg-nexus-input border border-nexus-border px-4 py-2 text-nexus-text focus:border-nexus-primary outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-nexus-muted mb-1">Bio</label>
                        <textarea
                            value={bio}
                            onChange={(e) => setBio(e.target.value)}
                            className="w-full rounded-lg bg-nexus-input border border-nexus-border px-4 py-2 text-nexus-text focus:border-nexus-primary outline-none h-24 resize-none"
                            placeholder="Tell us about yourself..."
                        />
                    </div>

                    {error && <p className="text-red-400 text-sm">{error}</p>}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-nexus-primary hover:opacity-90 text-white font-medium py-3 rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {loading ? "Saving..." : "Continue to Chat"} <ArrowRight className="w-4 h-4" />
                    </button>
                </form>
            </div>
        </div>
    )
}
