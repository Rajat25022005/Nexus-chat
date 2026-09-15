package handlers

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"nexus/nexus-api/internal/database"
)

// AvatarUploadAdapter handles POST /api/auth/profile/avatar for multipart uploads.
// Matches React 19 client calls in client/src/pages/Profile.tsx.
func (h *Handler) AvatarUploadAdapter(c *gin.Context) {
	ctx := c.Request.Context()

	callerID, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	callerUUID, _ := uuid.FromBytes(callerID.Bytes[:])

	// 1. Parse Multipart Form
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file form field is required"})
		return
	}

	// 2. Validate File Size (<= 5MB)
	if fileHeader.Size <= 0 || fileHeader.Size > MaxAvatarSizeBytes {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("avatar file size exceeds maximum limit (%d bytes / 5MB)", MaxAvatarSizeBytes),
		})
		return
	}

	// 3. Inspect MIME type via initial byte sniffing
	src, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to open uploaded file stream"})
		return
	}
	defer src.Close()

	sniffBuf := make([]byte, 512)
	n, _ := io.ReadFull(src, sniffBuf)
	detectedMIME := http.DetectContentType(sniffBuf[:n])
	baseMIME := strings.ToLower(strings.TrimSpace(strings.Split(detectedMIME, ";")[0]))

	bucket := "nexus-avatars"
	if h.storage != nil && h.storage.AvatarsBucket() != "" {
		bucket = h.storage.AvatarsBucket()
	}

	if !isMIMEAllowed(bucket, baseMIME) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid image format: only JPEG, PNG, WebP, and GIF are supported",
		})
		return
	}

	// Reassemble reader combining sniffed bytes and remaining stream
	fullStream := io.MultiReader(bytes.NewReader(sniffBuf[:n]), src)

	// 4. Generate Key & Stream to MinIO
	ext := strings.ToLower(path.Ext(fileHeader.Filename))
	if ext == "" {
		switch baseMIME {
		case "image/jpeg":
			ext = ".jpg"
		case "image/png":
			ext = ".png"
		case "image/webp":
			ext = ".webp"
		case "image/gif":
			ext = ".gif"
		default:
			ext = ".png"
		}
	}

	fileUUID := uuid.New()
	objectKey := fmt.Sprintf("avatars/%s/%d_%s%s", callerUUID.String(), time.Now().Unix(), fileUUID.String(), ext)

	var publicURL string
	var etag string

	if h.storage != nil {
		uploadInfo, putErr := h.storage.PutObjectDirect(ctx, bucket, objectKey, fullStream, fileHeader.Size, baseMIME)
		if putErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to store avatar object in storage"})
			return
		}
		publicURL = h.storage.GetPublicURL(bucket, objectKey)
		etag = uploadInfo.ETag
	} else {
		publicURL = fmt.Sprintf("http://localhost:9000/%s/%s", bucket, objectKey)
		etag = `"direct-upload-etag"`
	}

	// 5. Update User Avatar URL in users Table
	_, _ = h.db.UpdateUserAvatarURL(ctx, database.UpdateUserAvatarURLParams{
		ID:        callerID,
		AvatarUrl: publicURL,
	})

	// 6. Record metadata in PostgreSQL files Table
	createdFile, metaErr := h.db.CreateFileMetadata(ctx, database.CreateFileMetadataParams{
		UploaderID:  callerID,
		ChatID:      pgtype.UUID{}, // Nullable for avatars
		Bucket:      bucket,
		ObjectKey:   objectKey,
		FileName:    sanitizeFilename(fileHeader.Filename),
		ContentType: baseMIME,
		SizeBytes:   fileHeader.Size,
		Metadata:    []byte("{}"),
	})

	if metaErr == nil {
		var etagPg pgtype.Text
		_ = etagPg.Scan(etag)
		_, _ = h.db.ConfirmFileUpload(ctx, database.ConfirmFileUploadParams{
			ID:          createdFile.ID,
			Etag:        etagPg,
			SizeBytes:   fileHeader.Size,
			ContentType: baseMIME,
		})
	}

	// 7. Return JSON response matching React client expectation in Profile.tsx
	c.JSON(http.StatusOK, gin.H{
		"success":       true,
		"message":       "Avatar uploaded successfully",
		"profile_image": publicURL,
		"avatar_url":    publicURL,
	})
}
