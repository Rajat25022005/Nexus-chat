const API_URL_ENV = import.meta.env.VITE_API_URL

if (!API_URL_ENV) {
    console.warn("VITE_API_URL not set, using production backend as default")
}

export const API_URL = API_URL_ENV || "http://localhost:8080"
