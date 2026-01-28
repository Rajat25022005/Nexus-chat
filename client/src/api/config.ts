const API_URL_ENV = import.meta.env.VITE_API_URL
const DEFAULT_API_URL = "https://nexus-chat-741603203940.europe-west1.run.app"

if (!API_URL_ENV) {
    console.info(`VITE_API_URL not set. Using default backend: ${DEFAULT_API_URL}`)
}

export const API_URL = API_URL_ENV || DEFAULT_API_URL

export const getImageUrl = (path: string | undefined | null) => {
    if (!path) return undefined
    if (path.startsWith("http") || path.startsWith("data:")) return path
    return `${API_URL}${path}`
}
