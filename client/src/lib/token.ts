import { jwtDecode, type JwtPayload } from "jwt-decode"

/**
 * Standard JWT structure validation pattern (three base64url-encoded segments separated by dots).
 * Rejects any control characters, carriage returns, or newlines to prevent HTTP header injection.
 */
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

export interface NexusJwtPayload extends JwtPayload {
  user_id?: string
  email?: string
  username?: string
  role?: string
}

/**
 * Validates that the provided value is a non-empty string conforming strictly to JWT format
 * without any CRLF or header injection characters.
 */
export function isValidTokenFormat(token: unknown): token is string {
  if (typeof token !== "string" || !token.trim()) return false
  return JWT_PATTERN.test(token.trim())
}

/**
 * Safely decodes a JWT without throwing exceptions.
 */
export function decodeToken(token: string | null): NexusJwtPayload | null {
  if (!token || !isValidTokenFormat(token)) return null
  try {
    return jwtDecode<NexusJwtPayload>(token)
  } catch {
    return null
  }
}

/**
 * Checks whether a JWT token is expired, with a 5-second clock skew tolerance.
 * Returns true if token is missing, malformed, or past its expiration time.
 */
export function isTokenExpired(token: string | null): boolean {
  if (!token) return true
  const decoded = decodeToken(token)
  if (!decoded) return true

  // If token has no exp claim, consider it non-expiring
  if (!decoded.exp) return false

  // exp is in seconds, Date.now() is in milliseconds. 5000ms buffer for clock skew.
  const expirationMs = decoded.exp * 1000
  return Date.now() + 5000 >= expirationMs
}

/**
 * Sanitizes and validates a token string for safe usage in Authorization headers.
 * Returns null if the token is invalid, expired, or contains injection characters.
 */
export function sanitizeToken(token: string | null): string | null {
  if (!token || !isValidTokenFormat(token)) return null
  if (isTokenExpired(token)) return null
  return token.trim()
}

/**
 * Thoroughly purges all authenticated session tokens and cached room references
 * from client storage.
 */
export function purgeSessionTokens(): void {
  if (typeof window === "undefined" || !window.localStorage) return
  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith("nexus_") && key !== "nexus_theme") {
        keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key)
    }
  } catch (err) {
    console.error("Failed to purge session tokens:", err)
  }
}

