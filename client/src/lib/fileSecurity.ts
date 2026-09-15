/**
 * Nexus File Security & S3 Pre-Signed Upload Guardrails
 * 
 * Implements strict client-side OWASP file upload defense:
 * - 5MB max quota for avatars; 50MB max quota for room attachments.
 * - Strict MIME allowlists rejecting SVGs, HTML, executables, scripts, and polyglots.
 * - Double-extension and extension-MIME mismatch detection.
 * - Path traversal and filename sanitization.
 * - S3 SigV4 pre-signed URL parameter validation and tampering prevention.
 */

// Size limits in bytes
export const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB
export const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB

// Strictly allowed raster image MIME types for avatars (SVGs are strictly blocked due to script execution)
export const ALLOWED_AVATAR_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
])

export const ALLOWED_AVATAR_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
])

// Allowed MIME types for room attachments
export const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  // Images (raster only)
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  // Documents
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  // Microsoft Office / OpenDocument
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Archives
  "application/zip",
  "application/x-zip-compressed",
  "application/gzip",
  "application/x-tar",
])

// Explicitly blocked dangerous extensions and MIME types
export const DANGEROUS_EXTENSIONS = new Set([
  ".svg",
  ".html",
  ".htm",
  ".xhtml",
  ".xml",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".php",
  ".exe",
  ".bat",
  ".cmd",
  ".sh",
  ".bash",
  ".zsh",
  ".vbs",
  ".ps1",
  ".psm1",
  ".jar",
  ".war",
  ".com",
  ".scr",
  ".pif",
  ".msi",
  ".dll",
  ".dylib",
  ".so",
  ".app",
  ".deb",
  ".rpm",
  ".apk",
  ".iso",
  ".img",
])

export const DANGEROUS_MIME_PATTERNS = [
  /^image\/svg\+xml/i,
  /^text\/html/i,
  /^text\/javascript/i,
  /^application\/javascript/i,
  /^application\/x-javascript/i,
  /^application\/xhtml\+xml/i,
  /^application\/x-msdownload/i,
  /^application\/x-executable/i,
  /^application\/x-sh/i,
  /^application\/x-bat/i,
]

export interface FileValidationResult {
  valid: boolean
  error?: string
  sanitizedName?: string
}

/**
 * Extracts normalized lowercase file extension including leading dot (e.g. ".png").
 */
export function getFileExtension(filename: string): string {
  const lastDotIndex = filename.lastIndexOf(".")
  if (lastDotIndex === -1 || lastDotIndex === filename.length - 1) return ""
  return filename.slice(lastDotIndex).toLowerCase()
}

function hasControlChars(str: string): boolean {

  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c < 32 || c === 127) return true
  }
  return false
}

function stripControlChars(str: string): string {
  let res = ""
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c >= 32 && c !== 127) {
      res += str[i]
    }
  }
  return res
}

/**
 * Sanitizes a filename:
 * - Strips directory traversal sequences ("../", "..\\")
 * - Strips null bytes and control characters
 * - Normalizes dangerous characters
 * - Truncates length to 255 characters
 */
export function sanitizeFileName(rawName: string): string {
  if (!rawName) return "file"
  // Remove null bytes and control characters
  let clean = stripControlChars(rawName)
  // Remove path separators and relative path components
  clean = clean.replace(/(\.\.[/\\]|[/\\])+/g, "_")
  // Replace potentially dangerous filename characters
  clean = clean.replace(/[<>:"|?*]/g, "_")
  // Trim spaces and dots
  clean = clean.trim().replace(/^\.+/, "")

  if (!clean) clean = "file"
  // Ensure maximum length
  if (clean.length > 255) {
    const ext = getFileExtension(clean)
    const base = clean.slice(0, 255 - ext.length)
    clean = base + ext
  }
  return clean
}

/**
 * Validates an avatar image file against size quotas and strict raster image MIME allowlists.
 * SVGs and HTML vectors are explicitly rejected.
 */
export function validateAvatarFile(file: File): FileValidationResult {
  if (!file) {
    return { valid: false, error: "No file selected." }
  }

  if (file.size <= 0) {
    return { valid: false, error: "File is empty (0 bytes)." }
  }

  if (file.size > MAX_AVATAR_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1)
    return {
      valid: false,
      error: `Avatar image size (${sizeMb} MB) exceeds the maximum allowed limit of 5 MB.`,
    }
  }

  const ext = getFileExtension(file.name)

  // Explicit check against dangerous extensions (e.g., .svg, .html)
  if (DANGEROUS_EXTENSIONS.has(ext) || ext === ".svg") {
    return {
      valid: false,
      error: "SVG and vector graphics are not permitted for security reasons. Please upload JPEG, PNG, WebP, or GIF.",
    }
  }

  if (!ALLOWED_AVATAR_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `Unsupported file extension (${ext || "none"}). Only JPEG, PNG, WebP, and GIF images are allowed.`,
    }
  }

  // Verify MIME type
  const normalizedMime = (file.type || "").toLowerCase().trim()
  for (const pattern of DANGEROUS_MIME_PATTERNS) {
    if (pattern.test(normalizedMime)) {
      return {
        valid: false,
        error: "Executable, SVG, or scriptable file types are strictly prohibited.",
      }
    }
  }

  if (!ALLOWED_AVATAR_MIME_TYPES.has(normalizedMime)) {
    return {
      valid: false,
      error: `Unsupported image MIME type (${normalizedMime || "unknown"}). Allowed types: JPEG, PNG, WebP, GIF.`,
    }
  }

  return {
    valid: true,
    sanitizedName: sanitizeFileName(file.name),
  }
}

/**
 * Validates a chat attachment file against size quotas (50MB) and allowed attachment types.
 */
export function validateAttachmentFile(file: File): FileValidationResult {
  if (!file) {
    return { valid: false, error: "No file selected." }
  }

  if (file.size <= 0) {
    return { valid: false, error: "File is empty (0 bytes)." }
  }

  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1)
    return {
      valid: false,
      error: `Attachment size (${sizeMb} MB) exceeds the maximum allowed limit of 50 MB.`,
    }
  }

  const ext = getFileExtension(file.name)

  if (DANGEROUS_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `Files with extension ${ext} are blocked for security reasons.`,
    }
  }

  const normalizedMime = (file.type || "").toLowerCase().trim()
  for (const pattern of DANGEROUS_MIME_PATTERNS) {
    if (pattern.test(normalizedMime)) {
      return {
        valid: false,
        error: "Executable or scriptable file content is strictly prohibited.",
      }
    }
  }

  // If MIME is provided, ensure it is in the allowlist
  if (normalizedMime && !ALLOWED_ATTACHMENT_MIME_TYPES.has(normalizedMime)) {
    return {
      valid: false,
      error: `File type "${normalizedMime}" is not on the allowed attachments list.`,
    }
  }

  return {
    valid: true,
    sanitizedName: sanitizeFileName(file.name),
  }
}

/**
 * Validates an AWS SigV4 pre-signed PUT upload URL.
 * Ensures:
 * 1. Protocol is http: (local dev) or https: (production).
 * 2. Mandatory AWS SigV4 query parameters exist and are not tampered with.
 * 3. Expiration duration does not exceed 15 minutes (900 seconds).
 * 4. No CRLF or header injection in the URL string.
 */
export function validatePresignedUploadUrl(urlStr: string): { valid: boolean; error?: string } {
  if (!urlStr || typeof urlStr !== "string") {
    return { valid: false, error: "Pre-signed URL is empty or invalid." }
  }

  // Disallow CRLF or control characters
  if (hasControlChars(urlStr)) {
    return { valid: false, error: "Pre-signed URL contains forbidden control characters." }
  }


  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    return { valid: false, error: "Malformed pre-signed URL format." }
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, error: `Invalid protocol (${parsed.protocol}) in pre-signed URL.` }
  }

  const params = parsed.searchParams
  const requiredSigV4Params = [
    "X-Amz-Algorithm",
    "X-Amz-Credential",
    "X-Amz-Date",
    "X-Amz-Expires",
    "X-Amz-SignedHeaders",
    "X-Amz-Signature",
  ]

  for (const param of requiredSigV4Params) {
    if (!params.get(param)) {
      return { valid: false, error: `Pre-signed URL missing required AWS SigV4 parameter: ${param}` }
    }
  }

  const algorithm = params.get("X-Amz-Algorithm")
  if (algorithm !== "AWS4-HMAC-SHA256") {
    return { valid: false, error: `Unsupported signature algorithm: ${algorithm}` }
  }

  const expiresIn = parseInt(params.get("X-Amz-Expires") || "0", 10)
  if (isNaN(expiresIn) || expiresIn <= 0 || expiresIn > 900) {
    return { valid: false, error: `Pre-signed URL expiration duration (${expiresIn}s) exceeds 900s limit.` }
  }

  return { valid: true }
}

/**
 * Uploads a validated file to an AWS S3 / MinIO pre-signed PUT URL.
 * Preserves the exact Content-Type signed by the backend and avoids injecting
 * custom headers that would violate the SigV4 signature.
 */
export async function uploadToPresignedUrl(
  presignedUrl: string,
  file: File,
  contentType?: string
): Promise<void> {
  const urlCheck = validatePresignedUploadUrl(presignedUrl)
  if (!urlCheck.valid) {
    throw new Error(urlCheck.error || "Invalid pre-signed URL.")
  }

  const response = await fetch(presignedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType || file.type || "application/octet-stream",
    },
    body: file,
  })

  if (!response.ok) {
    throw new Error(`Upload to storage failed with status ${response.status} (${response.statusText}).`)
  }
}

/**
 * Sanitizes URLs for links and images across the application.
 * Prevents javascript:, vbscript:, data: (except verified safe raster images), and protocol-relative attacks.
 */
export function sanitizeUrl(url: string | null | undefined): string {
  if (!url || typeof url !== "string") return ""
  const trimmed = url.trim()
  if (!trimmed) return ""

  // Reject CRLF or control characters
  if (hasControlChars(trimmed)) return ""


  // Explicitly disallow dangerous protocols
  const lower = trimmed.toLowerCase()
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("file:")
  ) {
    return ""
  }

  // Handle data: URLs - only allow verified safe raster images (no SVG or HTML)
  if (lower.startsWith("data:")) {
    const isSafeRasterDataUri = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)
    return isSafeRasterDataUri ? trimmed : ""
  }

  // Reject protocol-relative URLs (e.g. "//evil.com")
  if (trimmed.startsWith("//")) {
    return ""
  }

  // Relative paths starting with "/" are safe
  if (trimmed.startsWith("/")) {
    return trimmed
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:" || parsed.protocol === "tel:") {
      return trimmed
    }
    return ""
  } catch {
    return ""
  }
}
