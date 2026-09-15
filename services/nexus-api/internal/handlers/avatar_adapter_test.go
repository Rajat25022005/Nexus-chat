package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"

	"nexus/nexus-api/internal/config"
	"nexus/nexus-api/internal/database"
)

// createMultipartRequest builds an HTTP POST request with a multipart form containing "file".
func createMultipartRequest(t *testing.T, url string, fieldName, filename string, content []byte) *http.Request {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile(fieldName, filename)
	if err != nil {
		t.Fatalf("failed to create form file: %v", err)
	}

	if _, err := part.Write(content); err != nil {
		t.Fatalf("failed to write content: %v", err)
	}

	if err := writer.Close(); err != nil {
		t.Fatalf("failed to close multipart writer: %v", err)
	}

	req, err := http.NewRequest("POST", url, body)
	if err != nil {
		t.Fatalf("failed to create request: %v", err)
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}

func TestAvatarAdapter_Success(t *testing.T) {
	callerID := uuid.New()
	avatarUpdatedInDB := false
	var updatedAvatarURL string
	uploadedToMinIO := false

	// Valid PNG magic bytes header
	pngBytes := append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0x00}, 100)...)

	mockQuerier := &MockQuerier{
		UpdateUserAvatarURLFn: func(ctx context.Context, arg database.UpdateUserAvatarURLParams) (database.User, error) {
			avatarUpdatedInDB = true
			updatedAvatarURL = arg.AvatarUrl
			return database.User{
				ID:        arg.ID,
				AvatarUrl: arg.AvatarUrl,
			}, nil
		},
		CreateFileMetadataFn: func(ctx context.Context, arg database.CreateFileMetadataParams) (database.File, error) {
			return database.File{
				ID:        uuidToPg(uuid.New()),
				Status:    "pending",
				Bucket:    arg.Bucket,
				ObjectKey: arg.ObjectKey,
			}, nil
		},
		ConfirmFileUploadFn: func(ctx context.Context, arg database.ConfirmFileUploadParams) (database.File, error) {
			return database.File{
				ID:     arg.ID,
				Status: "active",
			}, nil
		},
	}

	mockStorage := &MockStorageService{
		PutObjectDirectFn: func(ctx context.Context, bucket, objectKey string, reader io.Reader, size int64, contentType string) (minio.UploadInfo, error) {
			uploadedToMinIO = true
			return minio.UploadInfo{
				Bucket: bucket,
				Key:    objectKey,
				ETag:   `"etag-avatar"`,
				Size:   size,
			}, nil
		},
		GetPublicURLFn: func(bucket, objectKey string) string {
			return "http://localhost:9000/" + bucket + "/" + objectKey
		},
	}

	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(mockQuerier, nil, mockStorage, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	req := createMultipartRequest(t, "/api/auth/profile/avatar", "file", "avatar.png", pngBytes)
	req.Header.Set("Authorization", generateAuthHeader(t, callerID, "user@nexus.internal", cfg.JWTSecret))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for avatar upload, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode avatar response: %v", err)
	}

	if resp["success"] != true {
		t.Errorf("expected success: true, got %v", resp["success"])
	}
	if !strings.Contains(resp["profile_image"].(string), "nexus-avatars") {
		t.Errorf("expected profile_image URL with nexus-avatars, got %v", resp["profile_image"])
	}
	if !strings.Contains(resp["avatar_url"].(string), "nexus-avatars") {
		t.Errorf("expected avatar_url with nexus-avatars, got %v", resp["avatar_url"])
	}
	if !uploadedToMinIO {
		t.Errorf("expected avatar file to be uploaded to MinIO")
	}
	if !avatarUpdatedInDB {
		t.Errorf("expected user avatar to be updated in database")
	}
	if !strings.Contains(updatedAvatarURL, "nexus-avatars") {
		t.Errorf("expected database avatar URL to contain nexus-avatars, got %s", updatedAvatarURL)
	}
}

func TestAvatarAdapter_InvalidMIME(t *testing.T) {
	callerID := uuid.New()
	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(&MockQuerier{}, nil, &MockStorageService{}, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	// Disallowed text file bytes
	textBytes := []byte("plain text not image")
	req := createMultipartRequest(t, "/api/auth/profile/avatar", "file", "avatar.txt", textBytes)
	req.Header.Set("Authorization", generateAuthHeader(t, callerID, "user@nexus.internal", cfg.JWTSecret))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for non-image MIME, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAvatarAdapter_MissingFileField(t *testing.T) {
	callerID := uuid.New()
	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(&MockQuerier{}, nil, &MockStorageService{}, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	pngBytes := []byte("\x89PNG\r\n\x1a\n")
	// Field named "wrong_field" instead of "file"
	req := createMultipartRequest(t, "/api/auth/profile/avatar", "wrong_field", "avatar.png", pngBytes)
	req.Header.Set("Authorization", generateAuthHeader(t, callerID, "user@nexus.internal", cfg.JWTSecret))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing file field, got %d", w.Code)
	}
}
