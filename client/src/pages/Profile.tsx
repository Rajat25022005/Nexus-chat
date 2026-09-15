import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useAuthStore } from "../stores/authStore"
import { useWorkspace } from "../context/WorkspaceContext"
import { updateProfile, getProfile, uploadAvatar } from "../api/auth"
import { uploadFile } from "../api/files"
import { getImageUrl } from "../api/config"
import { validateAvatarFile } from "../lib/fileSecurity"
import { ArrowLeft, Camera, User, Check } from "lucide-react"
import NexusButton from "../components/ui/NexusButton"
import NexusInput from "../components/ui/NexusInput"
import GlassCard from "../components/ui/GlassCard"

export default function Profile() {
  const { token, login } = useAuthStore()
  const { userEmail, username: currentUsername } = useWorkspace()
  const navigate = useNavigate()

  const [username, setUsername] = useState(currentUsername || "")
  const [email, setEmail] = useState(userEmail || "")
  const [fullName, setFullName] = useState("")
  const [bio, setBio] = useState("")
  const [profileImage, setProfileImage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [imageLoading, setImageLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  useEffect(() => {
    document.title = "Profile — Nexus Chat"
  }, [])

  useEffect(() => {
    let isMounted = true
    const fetchMe = async () => {
      if (!token) return
      try {
        const data = await getProfile()
        if (!isMounted) return
        if (data.full_name) setFullName(data.full_name)
        if (data.bio) setBio(data.bio)
        if (data.username) setUsername(data.username)
        if (data.email) setEmail(data.email)
        if (data.profile_image) setProfileImage(data.profile_image)
      } catch (e) {
        console.error("Failed to fetch profile", e)
      }
    }
    fetchMe()
    return () => { isMounted = false }
  }, [token])

  // Auto-clear success
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(""), 3000)
      return () => clearTimeout(timer)
    }
  }, [success])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSuccess("")
    setLoading(true)

    try {
      if (!token) throw new Error("Not authenticated")
      await updateProfile(username, email, fullName, bio)
      login(token, email || userEmail, username || currentUsername)
      setSuccess("Profile updated")
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update profile")
    } finally {
      setLoading(false)
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !token) return

    // Enforce client-side file security validation (size <= 5MB, raster MIME only, no SVGs)
    const validation = validateAvatarFile(file)
    if (!validation.valid) {
      setError(validation.error || "Invalid image file")
      e.target.value = ""
      return
    }

    // Instant local preview
    const previewUrl = URL.createObjectURL(file)
    const previousImage = profileImage
    setProfileImage(previewUrl)
    setImageLoading(true)
    setError("")

    try {
      let finalAvatarUrl = ""
      try {
        // Try S3 pre-signed 2-phase upload
        const uploadRes = await uploadFile({ file, purpose: "avatar" })
        finalAvatarUrl = uploadRes.download_url || uploadRes.url || ""
      } catch (s3Err) {
        console.warn("S3 presign avatar upload fallback to multipart:", s3Err)
        // Fallback to avatar upload adapter endpoint
        const data = await uploadAvatar(file)
        finalAvatarUrl = data.profile_image || data.avatar_url || ""
      }

      if (finalAvatarUrl) {
        setProfileImage(`${finalAvatarUrl}?t=${Date.now()}`)
        setSuccess("Avatar updated successfully")
      }
    } catch (err: unknown) {
      setProfileImage(previousImage)
      setError(err instanceof Error ? err.message : "Failed to upload image")
    } finally {
      setImageLoading(false)
      e.target.value = ""
    }
  }

  return (
    <div className="min-h-screen bg-nexus-bg text-nexus-text flex flex-col items-center justify-center p-4">
      {/* Back button */}
      <div className="w-full max-w-md mb-4">
        <button
          onClick={() => navigate("/chat")}
          className="flex items-center gap-2 text-sm text-nexus-muted hover:text-nexus-text transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Chat
        </button>
      </div>

      <GlassCard className="w-full max-w-md p-6 md:p-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <h1 className="text-xl font-bold">Profile Settings</h1>
        </div>

        {/* Avatar */}
        <div className="flex justify-center mb-6">
          <div className="relative group cursor-pointer">
            <div className="w-24 h-24 rounded-full overflow-hidden border-3 border-nexus-bg ring-2 ring-nexus-border/40 bg-nexus-input flex items-center justify-center">
              {profileImage ? (
                <img src={getImageUrl(profileImage)} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <User className="w-10 h-10 text-nexus-muted" />
              )}
              {imageLoading && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                </div>
              )}
            </div>
            <label className="absolute bottom-0 right-0 bg-nexus-primary p-2 rounded-full cursor-pointer hover:brightness-110 transition-all shadow-lg group-hover:scale-110">
              <Camera className="w-3.5 h-3.5 text-white" />
              <input
                type="file"
                className="hidden"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleImageUpload}
                disabled={imageLoading}
              />
            </label>
          </div>
        </div>

        {error && (
          <div className="mb-4 text-sm text-red-400 bg-red-500/5 border border-red-500/10 rounded-xl px-3 py-2">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 text-sm text-emerald-400 bg-emerald-500/5 border border-emerald-500/10 rounded-xl px-3 py-2 flex items-center gap-2">
            <Check className="w-3.5 h-3.5" /> {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <NexusInput
            label="Full Name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Your full name"
          />
          <NexusInput
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username"
          />
          <NexusInput
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wider text-nexus-muted mb-1.5">
              Bio
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full rounded-xl bg-nexus-input border border-nexus-border px-4 py-2.5 text-nexus-text text-sm placeholder:text-nexus-muted/50 outline-none focus:border-nexus-primary/50 focus:ring-[3px] focus:ring-nexus-primary/10 transition-all h-20 resize-none"
              placeholder="Tell us about yourself..."
            />
          </div>

          <NexusButton type="submit" fullWidth disabled={loading} loading={loading}>
            Save Changes
          </NexusButton>
        </form>
      </GlassCard>
    </div>
  )
}
