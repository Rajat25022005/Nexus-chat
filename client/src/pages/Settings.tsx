import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { useWorkspace } from "../hooks/useWorkspace"
import { getProfile, updateProfile } from "../api/auth"
import { API_URL, getImageUrl } from "../api/config"
import {
    Search,
    Key,
    Lock,
    MessageSquare,
    Bell,
    Keyboard,
    HelpCircle,
    LogOut,
    ArrowLeft
} from "lucide-react"

export default function Settings() {
    const { logout } = useAuth()
    const { username, userEmail } = useWorkspace()
    const { token } = useAuth()
    const navigate = useNavigate()
    const [searchTerm, setSearchTerm] = useState("")
    const [bio, setBio] = useState("")
    const [isPrivate, setIsPrivate] = useState(false)
    const [activeSection, setActiveSection] = useState<string | null>(null)
    const [profileImage, setProfileImage] = useState<string | null>(null)

    useEffect(() => {
        if (token) {
            getProfile(token).then(data => {
                if (data.bio) setBio(data.bio)
                if (data.is_private !== undefined) setIsPrivate(data.is_private)
                if (data.profile_image) setProfileImage(data.profile_image)
            }).catch(console.error)
        }
    }, [token])

    const handlePrivacyToggle = async (checked: boolean) => {
        setIsPrivate(checked)
        if (token) {
            try {
                await updateProfile(token, undefined, undefined, undefined, undefined, checked)
            } catch (err) {
                console.error("Failed to update privacy", err)
                setIsPrivate(!checked)
            }
        }
    }

    const menuItems = [
        {
            icon: Key,
            label: "Account",
            subLabel: "Security notifications, account info"
        },
        {
            icon: Lock,
            label: "Privacy",
            subLabel: "Blocked contacts, disappearing messages"
        },
        {
            icon: MessageSquare,
            label: "Chats",
            subLabel: "Theme, wallpaper, chat settings"
        },
        {
            icon: Bell,
            label: "Notifications",
            subLabel: "Messages, groups, sounds"
        },
        {
            icon: Keyboard,
            label: "Keyboard shortcuts",
            subLabel: "Quick actions"
        },
        {
            icon: HelpCircle,
            label: "Help and feedback",
            subLabel: "Help centre, contact us, privacy policy"
        }
    ]

    return (
        <div className="flex h-screen bg-nexus-bg text-nexus-text overflow-hidden">
            {/* Sidebar / Navigation Area - similar width to main sidebar */}
            <div className="w-80 flex flex-col border-r border-nexus-border h-full">

                {/* Header */}
                <div className="p-4 flex items-center gap-3">
                    <button
                        onClick={() => navigate(-1)}
                        className="p-1 rounded-full hover:bg-nexus-card transition"
                    >
                        <ArrowLeft className="w-5 h-5 text-gray-400" />
                    </button>
                    <h1 className="text-xl font-semibold">Settings</h1>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-3 pb-4 scrollbar-thin scrollbar-thumb-nexus-border scrollbar-track-transparent">

                    {/* Search */}
                    <div className="mb-6 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search settings"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-[#202c33] text-sm text-gray-200 placeholder-gray-400 pl-9 pr-4 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-nexus-primary"
                        />
                    </div>

                    {/* Profile Section */}
                    <div
                        onClick={() => navigate("/profile")}
                        className="mb-6 flex items-center gap-4 px-1 cursor-pointer hover:bg-nexus-card p-2 rounded-lg transition"
                    >
                        <div className="w-16 h-16 rounded-full overflow-hidden bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xl font-bold text-white shrink-0">
                            {profileImage ? (
                                <img src={getImageUrl(profileImage)} alt="Profile" className="w-full h-full object-cover" />
                            ) : (
                                <span>{username?.[0]?.toUpperCase() || userEmail?.[0]?.toUpperCase()}</span>
                            )}
                        </div>
                        <div className="overflow-hidden">
                            <h2 className="text-lg font-medium truncate">{username || "User"}</h2>
                            <p className="text-sm text-gray-400 truncate">{bio}</p>
                        </div>
                    </div>

                    {/* Menu Items */}
                    <div className="space-y-1">
                        {menuItems
                            .filter(item =>
                                item.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                item.subLabel.toLowerCase().includes(searchTerm.toLowerCase())
                            )
                            .map((item, index) => (
                                <div
                                    key={index}
                                    onClick={() => setActiveSection(item.label)}
                                    className={`flex items-center gap-4 p-3 rounded-lg hover:bg-nexus-card cursor-pointer transition group ${activeSection === item.label ? "bg-nexus-card border border-nexus-border" : ""}`}
                                >
                                    <item.icon className={`w-5 h-5 transition-colors ${activeSection === item.label ? "text-nexus-primary" : "text-gray-400 group-hover:text-nexus-primary"}`} />
                                    <div>
                                        <div className={`text-[15px] font-normal ${activeSection === item.label ? "text-white" : "text-gray-200"}`}>{item.label}</div>
                                        <div className="text-[13px] text-gray-500">{item.subLabel}</div>
                                    </div>
                                </div>
                            ))}
                        {menuItems.filter(item =>
                            item.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            item.subLabel.toLowerCase().includes(searchTerm.toLowerCase())
                        ).length === 0 && (
                                <div className="p-4 text-center text-gray-500 text-sm">
                                    No settings found
                                </div>
                            )}
                    </div>

                    {/* Logout */}
                    <div className="mt-8 border-t border-white/5 pt-2">
                        <button
                            onClick={() => {
                                logout()
                                navigate("/login")
                            }}
                            className="w-full flex items-center gap-4 p-3 rounded-lg hover:bg-red-500/10 cursor-pointer transition text-red-400 hover:text-red-500"
                        >
                            <LogOut className="w-5 h-5" />
                            <span className="text-[15px] font-normal">Log out</span>
                        </button>
                    </div>

                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 bg-[#0b141a] flex flex-col">
                {activeSection === "Account" ? (
                    <div className="p-8 max-w-2xl">
                        <h2 className="text-2xl font-semibold mb-6">Account Settings</h2>

                        <div className="bg-nexus-card rounded-xl border border-nexus-border p-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-lg font-medium text-nexus-text">Private Account</h3>
                                    <p className="text-sm text-nexus-muted mt-1">
                                        When enabled, your name will be hidden in chats (shown as "User-XXXX").
                                        <br />Nexus AI will still know your name to assist you.
                                    </p>
                                </div>

                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={isPrivate}
                                        onChange={(e) => handlePrivacyToggle(e.target.checked)}
                                    />
                                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-nexus-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-nexus-primary"></div>
                                </label>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-center flex-1 text-gray-500">
                        <div className="text-center">
                            <div className="mb-4 inline-block p-4 rounded-full bg-nexus-card/50">
                                <Key className="w-12 h-12 opacity-20" />
                            </div>
                            <p>{activeSection ? `${activeSection} settings coming soon...` : "Select a setting to view details"}</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
