package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/minio/minio-go/v7"

	"nexus/nexus-api/internal/database"
)

const (
	MaxAvatarSizeBytes     int64 = 5 * 1024 * 1024       // 5 MB
	MaxAttachmentSizeBytes int64 = 50 * 1024 * 1024      // 50 MB
	PresignExpiryDuration        = 15 * time.Minute      // 900 seconds
	PresignExpirySeconds         = 900
)

type PresignUploadRequest struct {
	FileName    string `json:"file_name" binding:"required"`
	ContentType string `json:"content_type" binding:"required"`
	SizeBytes   int64  `json:"size_bytes" binding:"required"`
	Purpose     string `json:"purpose" binding:"required"` // "avatar" or "attachment"
	ChatID      string `json:"chat_id"`                    // Required when purpose == "attachment"
}

type PresignUploadResponse struct {
	FileID    string `json:"file_id"`
	UploadURL string `json:"upload_url"`
	ObjectKey string `json:"object_key"`
	Bucket    string `json:"bucket"`
	ExpiresIn int    `json:"expires_in"`
}

type ConfirmUploadRequest struct {
	FileID string `json:"file_id" binding:"required"`
}

type ConfirmUploadResponse struct {
	FileID      string `json:"file_id"`
	Status      string `json:"status"`
	FileName    string `json:"file_name"`
	ContentType string `json:"content_type"`
	SizeBytes   int64  `json:"size_bytes"`
	ETag        string `json:"etag"`
	DownloadURL string `json:"download_url"`
	ExpiresIn   int    `json:"expires_in"`
}

// sanitizeFilename extracts a clean, path-traversal-free base filename.
func sanitizeFilename(name string) string {
	clean := filepath.Base(filepath.Clean(name))
	clean = strings.ReplaceAll(clean, "/", "_")
	clean = strings.ReplaceAll(clean, "\\", "_")
	if clean == "" || clean == "." {
		return "file.bin"
	}
	return clean
}

// isMIMEAllowed validates MIME types against strict bucket allowlists.
func isMIMEAllowed(bucket, contentType string) bool {
	baseMIME := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))

	if bucket == "nexus-avatars" {
		switch baseMIME {
		case "image/jpeg", "image/png", "image/webp", "image/gif":
			return true
		default:
			return false
		}
	}

	// For attachments: explicitly reject SVGs, HTML, and executables
	if baseMIME == "image/svg+xml" || baseMIME == "text/html" || baseMIME == "application/javascript" {
		return false
	}
	if strings.Contains(baseMIME, "executable") || strings.Contains(baseMIME, "msdownload") || strings.Contains(baseMIME, "x-sh") {
		return false
	}

	if strings.HasPrefix(baseMIME, "image/") {
		return true
	}

	switch baseMIME {
	case "application/pdf", "text/plain", "text/markdown", "text/csv",
		"application/zip", "application/gzip", "application/x-tar",
		"application/msword",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"application/vnd.ms-excel",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"application/vnd.ms-powerpoint",
		"application/vnd.openxmlformats-officedocument.presentationml.presentation",
		"audio/mpeg", "audio/wav", "audio/ogg",
		"video/mp4", "video/webm":
		return true
	default:
		return false
	}
}

// PresignUpload handles POST /api/v1/files/presign-upload.
func (h *Handler) PresignUpload(c *gin.Context) {
	ctx := c.Request.Context()

	callerID, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req PresignUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	req.Purpose = strings.ToLower(strings.TrimSpace(req.Purpose))
	cleanMIME := strings.ToLower(strings.TrimSpace(strings.Split(req.ContentType, ";")[0]))

	var bucket string
	var maxAllowedSize int64
	var objectKey string
	var chatUUID pgtype.UUID

	fileUUID := uuid.New()
	callerUUID, _ := uuid.FromBytes(callerID.Bytes[:])

	switch req.Purpose {
	case "avatar":
		bucket = "nexus-avatars"
		if h.storage != nil && h.storage.AvatarsBucket() != "" {
			bucket = h.storage.AvatarsBucket()
		}
		maxAllowedSize = MaxAvatarSizeBytes

		if !isMIMEAllowed(bucket, cleanMIME) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "invalid content_type for avatar: only image/jpeg, image/png, image/webp, and image/gif are supported",
			})
			return
		}

		if req.SizeBytes <= 0 || req.SizeBytes > maxAllowedSize {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf("file size exceeds maximum allowed for avatar (%d bytes / 5MB)", maxAllowedSize),
			})
			return
		}

		ext := strings.ToLower(path.Ext(req.FileName))
		if ext == "" {
			switch cleanMIME {
			case "image/jpeg":
				ext = ".jpg"
			case "image/png":
				ext = ".png"
			case "image/webp":
				ext = ".webp"
			case "image/gif":
				ext = ".gif"
			default:
				ext = ".img"
			}
		}

		objectKey = fmt.Sprintf("avatars/%s/%d_%s%s", callerUUID.String(), time.Now().Unix(), fileUUID.String(), ext)

	case "attachment":
		bucket = "nexus-attachments"
		if h.storage != nil && h.storage.AttachmentsBucket() != "" {
			bucket = h.storage.AttachmentsBucket()
		}
		maxAllowedSize = MaxAttachmentSizeBytes

		if req.ChatID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "chat_id is required for attachments"})
			return
		}

		parsedChatID, parseErr := parseUUID(req.ChatID)
		if parseErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid chat_id format"})
			return
		}
		chatUUID = parsedChatID

		// Authorization check: Caller must be a member of the group owning the chat
		chat, queryErr := h.db.GetChatByID(ctx, chatUUID)
		if queryErr != nil {
			if errors.Is(queryErr, pgx.ErrNoRows) {
				c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query chat"})
			return
		}

		_, memberErr := h.db.GetGroupMember(ctx, database.GetGroupMemberParams{
			GroupID: chat.GroupID,
			UserID:  callerID,
		})
		if memberErr != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden: you are not a member of this chat's group"})
			return
		}

		if !isMIMEAllowed(bucket, cleanMIME) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf("unsupported attachment content_type '%s'", cleanMIME),
			})
			return
		}

		if req.SizeBytes <= 0 || req.SizeBytes > maxAllowedSize {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf("file size exceeds maximum allowed for attachment (%d bytes / 50MB)", maxAllowedSize),
			})
			return
		}

		sanitized := sanitizeFilename(req.FileName)
		chatUUIDStr := formatUUID(chatUUID)
		objectKey = fmt.Sprintf("attachments/%s/%s/%s", chatUUIDStr, fileUUID.String(), sanitized)

	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "purpose must be either 'avatar' or 'attachment'"})
		return
	}

	// 1. Insert pending metadata record into PostgreSQL
	var fileUIDPg pgtype.UUID
	fileUIDPg.Bytes = fileUUID
	fileUIDPg.Valid = true

	createdFile, err := h.db.CreateFileMetadata(ctx, database.CreateFileMetadataParams{
		UploaderID:  callerID,
		ChatID:      chatUUID,
		Bucket:      bucket,
		ObjectKey:   objectKey,
		FileName:    sanitizeFilename(req.FileName),
		ContentType: cleanMIME,
		SizeBytes:   req.SizeBytes,
		Metadata:    []byte("{}"),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record pending file metadata"})
		return
	}

	// 2. Generate 15-minute AWS SigV4 pre-signed PUT URL
	var uploadURL string
	if h.storage != nil {
		signedURL, presignErr := h.storage.PresignPutURL(ctx, bucket, objectKey, cleanMIME, PresignExpiryDuration)
		if presignErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate presigned upload URL"})
			return
		}
		uploadURL = signedURL
	} else {
		uploadURL = fmt.Sprintf("http://localhost:9000/%s/%s", bucket, objectKey)
	}

	c.JSON(http.StatusCreated, PresignUploadResponse{
		FileID:    formatUUID(createdFile.ID),
		UploadURL: uploadURL,
		ObjectKey: objectKey,
		Bucket:    bucket,
		ExpiresIn: PresignExpirySeconds,
	})
}

// ConfirmUpload handles POST /api/v1/files/confirm-upload.
func (h *Handler) ConfirmUpload(c *gin.Context) {
	ctx := c.Request.Context()

	callerID, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req ConfirmUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file_id is required"})
		return
	}

	fileID, err := parseUUID(req.FileID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file_id format"})
		return
	}

	// 1. Query metadata row from database
	file, err := h.db.GetFileByID(ctx, fileID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query file metadata"})
		return
	}

	// 2. Check deletion status
	if file.DeletedAt.Valid || file.Status == "deleted" {
		c.JSON(http.StatusGone, gin.H{"error": "file has been deleted"})
		return
	}

	// 3. Authorization: Caller must be the original uploader
	if file.UploaderID != callerID {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden: you are not the uploader of this file"})
		return
	}

	// 4. Fast-path Idempotency
	if file.Status == "active" {
		h.respondWithActiveFile(c, file)
		return
	}

	// 5. MinIO StatObject verification via internalClient
	var stat minio.ObjectInfo
	if h.storage != nil {
		var statErr error
		stat, statErr = h.storage.StatObject(ctx, file.Bucket, file.ObjectKey)
		if statErr != nil {
			var minioErr minio.ErrorResponse
			if errors.As(statErr, &minioErr) && (minioErr.Code == "NoSuchKey" || minioErr.StatusCode == http.StatusNotFound) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "object not found in storage; upload incomplete"})
				return
			}
			msg := statErr.Error()
			if strings.Contains(msg, "NoSuchKey") || strings.Contains(msg, "not found") {
				c.JSON(http.StatusBadRequest, gin.H{"error": "object not found in storage; upload incomplete"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "storage verification failed"})
			return
		}
	} else {
		// Mock fallback if storage is nil
		stat = minio.ObjectInfo{
			Size:        file.SizeBytes,
			ContentType: file.ContentType,
			ETag:        `"mock-etag"`,
		}
	}

	// 6. Server-side size enforcement & Rogue object cleanup
	maxAllowedSize := MaxAttachmentSizeBytes
	if file.Bucket == "nexus-avatars" {
		maxAllowedSize = MaxAvatarSizeBytes
	}

	if stat.Size <= 0 || stat.Size > maxAllowedSize {
		if h.storage != nil {
			_ = h.storage.DeleteObject(ctx, file.Bucket, file.ObjectKey)
		}
		_ = h.db.SoftDeleteFile(ctx, file.ID)
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("uploaded file size (%d bytes) exceeds allowed limit (%d bytes) for %s",
				stat.Size, maxAllowedSize, file.Bucket),
		})
		return
	}

	// 7. Server-side MIME verification & Rogue object cleanup
	detectedMIME := strings.ToLower(strings.TrimSpace(stat.ContentType))
	if detectedMIME == "" {
		detectedMIME = file.ContentType
	}

	if !isMIMEAllowed(file.Bucket, detectedMIME) {
		if h.storage != nil {
			_ = h.storage.DeleteObject(ctx, file.Bucket, file.ObjectKey)
		}
		_ = h.db.SoftDeleteFile(ctx, file.ID)
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("disallowed content-type '%s' detected in storage", detectedMIME),
		})
		return
	}

	// 8. Database update & metadata synchronization
	var etagPg pgtype.Text
	_ = etagPg.Scan(stat.ETag)

	confirmedFile, err := h.db.ConfirmFileUpload(ctx, database.ConfirmFileUploadParams{
		ID:          file.ID,
		Etag:        etagPg,
		SizeBytes:   stat.Size,
		ContentType: detectedMIME,
	})
	if err != nil {
		// Concurrency race: status was flipped to 'active' milliseconds earlier
		if errors.Is(err, pgx.ErrNoRows) {
			activeFile, getErr := h.db.GetFileByID(ctx, file.ID)
			if getErr == nil && activeFile.Status == "active" {
				h.respondWithActiveFile(c, activeFile)
				return
			}
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record file confirmation"})
		return
	}

	h.respondWithActiveFile(c, confirmedFile)
}

// respondWithActiveFile shapes and returns the confirmed active file response.
func (h *Handler) respondWithActiveFile(c *gin.Context, file database.File) {
	ctx := c.Request.Context()
	var downloadURL string
	var expiresIn int

	if file.Bucket == "nexus-avatars" {
		if h.storage != nil {
			downloadURL = h.storage.GetPublicURL(file.Bucket, file.ObjectKey)
		} else {
			downloadURL = fmt.Sprintf("http://localhost:9000/%s/%s", file.Bucket, file.ObjectKey)
		}
		expiresIn = 0

		_, _ = h.db.UpdateUserAvatarURL(ctx, database.UpdateUserAvatarURLParams{
			ID:        file.UploaderID,
			AvatarUrl: downloadURL,
		})
	} else {
		if h.storage != nil {
			presigned, err := h.storage.PresignGetURL(ctx, file.Bucket, file.ObjectKey, file.FileName, PresignExpiryDuration)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate download URL"})
				return
			}
			downloadURL = presigned
		} else {
			downloadURL = fmt.Sprintf("http://localhost:9000/%s/%s", file.Bucket, file.ObjectKey)
		}
		expiresIn = PresignExpirySeconds
	}

	etagVal := ""
	if file.Etag.Valid {
		etagVal = file.Etag.String
	}

	c.JSON(http.StatusOK, ConfirmUploadResponse{
		FileID:      formatUUID(file.ID),
		Status:      file.Status,
		FileName:    file.FileName,
		ContentType: file.ContentType,
		SizeBytes:   file.SizeBytes,
		ETag:        etagVal,
		DownloadURL: downloadURL,
		ExpiresIn:   expiresIn,
	})
}

// DownloadFile handles GET /api/v1/files/:id/download.
func (h *Handler) DownloadFile(c *gin.Context) {
	ctx := c.Request.Context()

	callerID, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	fileID, ok := parseUUIDParam(c, "id")
	if !ok {
		return
	}

	// 1. Retrieve file metadata
	file, err := h.db.GetFileByID(ctx, fileID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query file metadata"})
		return
	}

	if file.DeletedAt.Valid || file.Status != "active" {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found or not active"})
		return
	}

	redirect := c.DefaultQuery("redirect", "true") == "true"

	// 2. Avatar bucket: public access
	if file.Bucket == "nexus-avatars" {
		var publicURL string
		if h.storage != nil {
			publicURL = h.storage.GetPublicURL(file.Bucket, file.ObjectKey)
		} else {
			publicURL = fmt.Sprintf("http://localhost:9000/%s/%s", file.Bucket, file.ObjectKey)
		}

		if redirect {
			c.Redirect(http.StatusFound, publicURL)
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"file_id":      formatUUID(file.ID),
			"file_name":    file.FileName,
			"download_url": publicURL,
			"expires_in":   0,
		})
		return
	}

	// 3. Attachments bucket: authorization boundary check
	if file.ChatID.Valid {
		chat, queryErr := h.db.GetChatByID(ctx, file.ChatID)
		if queryErr != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "chat room not found"})
			return
		}

		_, memberErr := h.db.GetGroupMember(ctx, database.GetGroupMemberParams{
			GroupID: chat.GroupID,
			UserID:  callerID,
		})
		if memberErr != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden: you are not a member of this chat"})
			return
		}
	}

	var downloadURL string
	if h.storage != nil {
		presigned, presignErr := h.storage.PresignGetURL(ctx, file.Bucket, file.ObjectKey, file.FileName, PresignExpiryDuration)
		if presignErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate secure download URL"})
			return
		}
		downloadURL = presigned
	} else {
		downloadURL = fmt.Sprintf("http://localhost:9000/%s/%s", file.Bucket, file.ObjectKey)
	}

	if redirect {
		c.Redirect(http.StatusFound, downloadURL)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"file_id":      formatUUID(file.ID),
		"file_name":    file.FileName,
		"content_type": file.ContentType,
		"size_bytes":   file.SizeBytes,
		"download_url": downloadURL,
		"expires_in":   PresignExpirySeconds,
	})
}
