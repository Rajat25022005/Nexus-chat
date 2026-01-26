import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { useWorkspace } from "../hooks/useWorkspace"
import { updateProfile } from "../api/auth"
import { ArrowLeft } from "lucide-react"

export default function Profile() {
    const { token, login } = useAuth()
    const { userEmail, username: currentUsername } = useWorkspace()
    const navigate = useNavigate()

    const [username, setUsername] = useState("")
    const [email, setEmail] = useState("")
    const [fullName, setFullName] = useState("")
    const [bio, setBio] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")
    const [success, setSuccess] = useState("")

    useEffect(() => {
        if (currentUsername) setUsername(currentUsername)
        if (userEmail) setEmail(userEmail)
        // Fetch full profile details if possible, for now we default to empty if not known
        // Improvements: Add GET /auth/me to fetch these details
        const fetchMe = async () => {
            if (!token) return
            try {
                const res = await fetch(`${import.meta.env.VITE_API_URL || "http://localhost:8080"}/auth/me`, {
                    headers: { Authorization: `Bearer ${token}` }
                })
                if (res.ok) {
                    const data = await res.json()
                    if (data.full_name) setFullName(data.full_name)
                    if (data.bio) setBio(data.bio)
                    if (data.username) setUsername(data.username)
                    if (data.email) setEmail(data.email)
                }
            } catch (e) {
                console.error("Failed to fetch profile", e)
            }
        }
        fetchMe()
    }, [currentUsername, userEmail, token])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")
        setSuccess("")
        setLoading(true)

        try {
            if (!token) throw new Error("Not authenticated")

            const data = await updateProfile(token, username, email, fullName, bio)

            // Update local auth with new token
            login(data.access_token)

            setSuccess("Profile updated successfully")
        } catch (err: unknown) {
            if (err instanceof Error) {
                setError(err.message)
            } else {
                setError("Failed to update profile")
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-nexus-bg text-nexus-text">
            <div className="w-full max-w-md p-8 bg-nexus-card rounded-xl border border-nexus-border shadow-2xl my-8">
                <div className="flex items-center mb-6">
                    <button
                        onClick={() => navigate("/chat")}
                        className="mr-4 p-2 rounded-full hover:bg-nexus-bg transition text-nexus-muted hover:text-nexus-text"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <h1 className="text-2xl font-bold">Profile Settings</h1>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-nexus-muted mb-1">Full Name</label>
                        <input
                            type="text"
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            className="w-full rounded-lg bg-nexus-input border border-nexus-border px-4 py-2 text-nexus-text focus:border-nexus-primary outline-none"
                            placeholder="John Doe"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-nexus-muted mb-1">Username</label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full rounded-lg bg-nexus-input border border-nexus-border px-4 py-2 text-nexus-text focus:border-nexus-primary outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-nexus-muted mb-1">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
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
                    {success && <p className="text-emerald-400 text-sm">{success}</p>}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-nexus-primary hover:opacity-90 text-white font-medium py-2 rounded-lg transition disabled:opacity-50"
                    >
                        {loading ? "Saving..." : "Save Changes"}
                    </button>
                </form>
            </div>
        </div>
    )
}
