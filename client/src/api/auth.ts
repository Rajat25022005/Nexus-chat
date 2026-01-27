import { API_URL } from "./config"

export async function updateProfile(token: string, username?: string, email?: string, full_name?: string, bio?: string, is_private?: boolean) {
    const res = await fetch(`${API_URL}/auth/profile`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username, email, full_name, bio, is_private }),
    })

    if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.detail || "Failed to update profile")
    }

    return res.json()
}

export async function getProfile(token: string) {
    const res = await fetch(`${API_URL}/auth/me`, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    })

    if (!res.ok) {
        throw new Error("Failed to fetch profile")
    }


    return res.json()
}

export async function uploadAvatar(token: string, file: File) {
    const formData = new FormData()
    formData.append("file", file)

    const res = await fetch(`${API_URL}/auth/profile/avatar`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
        },
        body: formData,
    })

    if (!res.ok) {
        throw new Error("Failed to upload avatar")
    }

    return res.json()
}
