import { API_URL } from "./config"

export async function updateProfile(token: string, username?: string, email?: string, full_name?: string, bio?: string) {
    const res = await fetch(`${API_URL}/auth/profile`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username, email, full_name, bio }),
    })

    if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.detail || "Failed to update profile")
    }

    return res.json()
}
