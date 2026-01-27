import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { useWorkspace } from "../hooks/useWorkspace"
import { updateProfile, getProfile, uploadAvatar } from "../api/auth"
import { ArrowLeft, Camera, User } from "lucide-react"
import { API_URL, getImageUrl } from "../api/config"

export default function Profile() {
    const { token, login } = useAuth()
    const { userEmail, username: currentUsername } = useWorkspace()
    const navigate = useNavigate()

    const [username, setUsername] = useState("")
    const [email, setEmail] = useState("")
    const [fullName, setFullName] = useState("")
    const [bio, setBio] = useState("")
    const [profileImage, setProfileImage] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [imageLoading, setImageLoading] = useState(false)
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
                const data = await getProfile(token)
                setFullName(data.full_name || "")
                setBio(data.bio || "")
                setUsername(data.username || "")
                setEmail(data.email || "")
                if (data.profile_image) setProfileImage(data.profile_image)
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

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file || !token) return

        setImageLoading(true)
        setError("")
        try {
            const data = await uploadAvatar(token, file)
            // Add timestamp/random query param to force refresh if URL is same (though our filename is stable based on ID, so cache bust is good)
            // Actually filename is ID + ext, so effectively stable.
            setProfileImage(`${data.profile_image}?t=${Date.now()}`)
        } catch (err) {
            console.error(err)
            setError("Failed to upload image")
        } finally {
            setImageLoading(false)
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



                <div className="flex justify-center mb-8">

                    <div className="relative group cursor-pointer">
                        <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-nexus-bg ring-2 ring-nexus-border bg-nexus-input flex items-center justify-center">


                            {profileImage ? (
                                <img src={getImageUrl(profileImage)} alt="Profile" className="w-full h-full object-cover" />
                            ) : (
                                <User className="w-10 h-10 text-nexus-muted" />
                            )}
                            {imageLoading && (
                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                                </div>
                            )}
                        </div>
                        <label className="absolute bottom-0 right-0 bg-nexus-primary p-2 rounded-full cursor-pointer hover:bg-opacity-90 transition shadow-lg">
                            <Camera className="w-4 h-4 text-white" />
                            <input
                                type="file"
                                className="hidden"
                                accept="image/*"
                                onChange={handleImageUpload}
                                disabled={imageLoading}
                            />
                        </label>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-nexus-muted mb-1">Full Name</label>
                        <input
                            type="text"
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            className="w-full rounded-lg bg-nexus-input border border-nexus-border px-4 py-2 text-nexus-text focus:border-nexus-primary outline-none"
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
            </div >
        </div >
    )
}
