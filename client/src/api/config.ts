const REST_API_URL_ENV = import.meta.env.VITE_REST_API_URL
const SOCKET_URL_ENV = import.meta.env.VITE_SOCKET_URL

const DEFAULT_REST_URL = "http://localhost:8080"
const DEFAULT_SOCKET_URL = "http://localhost:3001"


if (!REST_API_URL_ENV) {
    console.info(`VITE_REST_API_URL not set. Using default backend: ${DEFAULT_REST_URL}`)
}
if (!SOCKET_URL_ENV) {
    console.info(`VITE_SOCKET_URL not set. Using default socket: ${DEFAULT_SOCKET_URL}`)
}

export const REST_API_URL = REST_API_URL_ENV || DEFAULT_REST_URL
export const SOCKET_URL = SOCKET_URL_ENV || DEFAULT_SOCKET_URL

// Alias API_URL to REST_API_URL to maintain compatibility with existing code
export const API_URL = REST_API_URL

export const getImageUrl = (path: string | undefined | null): string | undefined => {
    if (!path || typeof path !== "string") return undefined
    const trimmed = path.trim()
    if (!trimmed) return undefined

    // Reject control characters or newlines
    for (let i = 0; i < trimmed.length; i++) {
        const c = trimmed.charCodeAt(i)
        if (c < 32 || c === 127) return undefined
    }

    const lower = trimmed.toLowerCase()

    // Explicitly reject dangerous executable/scripting schemes
    if (lower.startsWith("javascript:") || lower.startsWith("vbscript:") || lower.startsWith("file:")) {
        return undefined
    }

    // Reject protocol-relative URLs (e.g. "//evil.com")
    if (trimmed.startsWith("//")) {
        return undefined
    }

    // If data URI, strictly permit only verified safe raster images (reject SVGs and HTML)
    if (lower.startsWith("data:")) {
        const isSafeRaster = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)
        return isSafeRaster ? trimmed : undefined
    }

    // If absolute HTTP/HTTPS URL, validate protocol
    if (lower.startsWith("http://") || lower.startsWith("https://")) {
        try {
            const parsed = new URL(trimmed)
            if (parsed.protocol === "http:" || parsed.protocol === "https:") {
                return trimmed
            }
        } catch {
            return undefined
        }
        return undefined
    }

    // Clean relative paths - ensure single leading slash and strip traversal
    const cleanPath = trimmed.replace(/(\.\.[/\\]|[/\\])+/g, "/")
    const normalizedPath = cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`
    return `${API_URL}${normalizedPath}`
}

