import apiClient from "./client"

export interface PresignUploadParams {
  fileName: string
  contentType: string
  sizeBytes: number
  purpose: "avatar" | "attachment"
  chatId?: string
}

export interface PresignUploadResponse {
  file_id: string
  upload_url: string
  object_key: string
  bucket: string
  expires_in: number
}

export interface ConfirmUploadResponse {
  file_id: string
  status: string
  file_name: string
  content_type: string
  size_bytes: number
  etag?: string
  download_url: string
  url?: string
}

export interface DownloadFileResponse {
  file_id: string
  file_name?: string
  content_type?: string
  size_bytes?: number
  download_url: string
  expires_in: number
}

/**
 * Validates upload constraints and requests a pre-signed S3 PUT URL.
 */
export async function presignUpload(params: PresignUploadParams): Promise<PresignUploadResponse> {
  const res = await apiClient.post<PresignUploadResponse>("/api/v1/files/presign-upload", {
    file_name: params.fileName,
    content_type: params.contentType,
    size_bytes: params.sizeBytes,
    purpose: params.purpose,
    chat_id: params.chatId,
  })
  return res.data
}

/**
 * Uploads binary file data directly to the S3/MinIO pre-signed URL via HTTP PUT.
 */
export function uploadToS3(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress?: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", uploadUrl, true)
    xhr.setRequestHeader("Content-Type", contentType || "application/octet-stream")

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100)
          onProgress(pct)
        }
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`S3 upload failed with status ${xhr.status}`))
      }
    }

    xhr.onerror = () => reject(new Error("Network error during S3 upload"))
    xhr.onabort = () => reject(new Error("Upload aborted"))

    xhr.send(file)
  })
}

/**
 * Confirms file upload completion, verifies storage presence, and registers the active file.
 */
export async function confirmUpload(fileId: string): Promise<ConfirmUploadResponse> {
  const res = await apiClient.post<ConfirmUploadResponse>("/api/v1/files/confirm-upload", {
    file_id: fileId,
  })
  return res.data
}

/**
 * Complete two-phase S3 upload lifecycle:
 * 1. Presign upload URL
 * 2. PUT binary to S3
 * 3. Confirm upload
 */
export async function uploadFile({
  file,
  purpose,
  chatId,
  onProgress,
}: {
  file: File
  purpose: "avatar" | "attachment"
  chatId?: string
  onProgress?: (pct: number) => void
}): Promise<ConfirmUploadResponse> {
  const contentType = file.type || "application/octet-stream"

  const presign = await presignUpload({
    fileName: file.name,
    contentType,
    sizeBytes: file.size,
    purpose,
    chatId,
  })

  await uploadToS3(presign.upload_url, file, contentType, onProgress)

  const confirmed = await confirmUpload(presign.file_id)
  return confirmed
}

/**
 * Requests a fresh pre-signed GET download URL for an active file.
 * Query parameter `redirect=false` ensures the server responds with a JSON payload
 * containing the pre-signed URL and expiration window.
 */
export async function downloadFile(
  fileId: string
): Promise<{ file_id: string; download_url: string; expires_in: number }> {
  const res = await apiClient.get<DownloadFileResponse>(
    `/api/v1/files/${encodeURIComponent(fileId)}/download`,
    {
      params: { redirect: "false" },
    }
  )
  return res.data
}
