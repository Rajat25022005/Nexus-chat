package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/minio/minio-go/v7"

	"nexus/nexus-api/internal/config"
	"nexus/nexus-api/internal/database"
)

func TestFiles_PresignUpload_AvatarSizeAndMIME(t *testing.T) {
	callerID := uuid.New()
	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(&MockQuerier{}, nil, &MockStorageService{}, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	// 1. Avatar exceeding 5MB
	bodyOversized := `{"file_name": "avatar.png", "content_type": "image/png", "size_bytes": 6000000, "purpose": "avatar"}`
	req1, _ := http.NewRequest("POST", "/api/v1/files/presign-upload", strings.NewReader(bodyOversized))
	req1.Header.Set("Authorization", generateAuthHeader(t, callerID, "user@nexus.internal", cfg.JWTSecret))
	req1.Header.Set("Content-Type", "application/json")
	w1 := httptest.NewRecorder()
	router.ServeHTTP(w1, req1)
	if w1.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for oversized avatar, got %d", w1.Code)
	}

	// 2. Disallowed MIME for avatar (e.g. SVG or PDF)
	bodyDisallowed := `{"file_name": "avatar.svg", "content_type": "image/svg+xml", "size_bytes": 1024, "purpose": "avatar"}`
	req2, _ := http.NewRequest("POST", "/api/v1/files/presign-upload", strings.NewReader(bodyDisallowed))
	req2.Header.Set("Authorization", generateAuthHeader(t, callerID, "user@nexus.internal", cfg.JWTSecret))
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, req2)
	if w2.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for SVG avatar, got %d", w2.Code)
	}
}

func TestFiles_PresignUpload_AttachmentAuthorization(t *testing.T) {
	callerID := uuid.New()
	chatID := uuid.New()
	groupID := uuid.New()

	mockQuerier := &MockQuerier{
		GetChatByIDFn: func(ctx context.Context, id pgtype.UUID) (database.Chat, error) {
			return database.Chat{
				ID:      id,
				GroupID: uuidToPg(groupID),
			}, nil
		},
		GetGroupMemberFn: func(ctx context.Context, arg database.GetGroupMemberParams) (database.GroupMember, error) {
			// Simulating caller is NOT a member of this chat's group
			return database.GroupMember{}, errors.New("not a member")
		},
	}

	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(mockQuerier, nil, &MockStorageService{}, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	body := `{"file_name": "doc.pdf", "content_type": "application/pdf", "size_bytes": 1024, "purpose": "attachment", "chat_id": "` + chatID.String() + `"}`
	req, _ := http.NewRequest("POST", "/api/v1/files/presign-upload", strings.NewReader(body))
	req.Header.Set("Authorization", generateAuthHeader(t, callerID, "user@nexus.internal", cfg.JWTSecret))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for non-member attachment upload, got %d: %s", w.Code, w.Body.String())
	}
}

func TestFiles_PresignUpload_Success(t *testing.T) {
	callerID := uuid.New()
	chatID := uuid.New()
	groupID := uuid.New()
	fileID := uuid.New()

	mockQuerier := &MockQuerier{
		GetChatByIDFn: func(ctx context.Context, id pgtype.UUID) (database.Chat, error) {
			return database.Chat{
				ID:      id,
				GroupID: uuidToPg(groupID),
			}, nil
		},
		GetGroupMemberFn: func(ctx context.Context, arg database.GetGroupMemberParams) (database.GroupMember, error) {
			return database.GroupMember{
				GroupID: uuidToPg(groupID),
				UserID:  uuidToPg(callerID),
				Role:    "member",
			}, nil
		},
		CreateFileMetadataFn: func(ctx context.Context, arg database.CreateFileMetadataParams) (database.File, error) {
			return database.File{
				ID:        uuidToPg(fileID),
				FileName:  arg.FileName,
				Bucket:    arg.Bucket,
				ObjectKey: arg.ObjectKey,
				SizeBytes: arg.SizeBytes,
				Status:    "pending",
			}, nil
		},
	}

	mockStorage := &MockStorageService{
		PresignPutURLFn: func(ctx context.Context, bucket, objectKey, contentType string, expires time.Duration) (string, error) {
			return "http://localhost:9000/" + bucket + "/" + objectKey + "?signed=true", nil
		},
	}

	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(mockQuerier, nil, mockStorage, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	body := `{"file_name": "quarterly.pdf", "content_type": "application/pdf", "size_bytes": 2048, "purpose": "attachment", "chat_id": "` + chatID.String() + `"}`
	req, _ := http.NewRequest("POST", "/api/v1/files/presign-upload", strings.NewReader(body))
	req.Header.Set("Authorization", generateAuthHeader(t, callerID, "user@nexus.internal", cfg.JWTSecret))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
	}

	var resp PresignUploadResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.FileID != fileID.String() {
		t.Errorf("expected file_id %s, got %s", fileID, resp.FileID)
	}
	if resp.Bucket != "nexus-attachments" {
		t.Errorf("expected bucket nexus-attachments, got %s", resp.Bucket)
	}
	if !strings.Contains(resp.UploadURL, "signed=true") {
		t.Errorf("expected signed upload URL, got %s", resp.UploadURL)
	}
}

func TestFiles_ConfirmUpload_NoSuchKey(t *testing.T) {
	callerID := uuid.New()
	fileID := uuid.New()

	mockQuerier := &MockQuerier{
		GetFileByIDFn: func(ctx context.Context, id pgtype.UUID) (database.File, error) {
			return database.File{
				ID:         id,
				UploaderID: uuidToPg(callerID),
				Bucket:     "nexus-attachments",
				ObjectKey:  "attachments/123/file.pdf",
				Status:     "pending",
				SizeBytes:  1024,
			}, nil
		},
	}

	mockStorage := &MockStorageService{
		StatObjectFn: func(ctx context.Context, bucket, objectKey string) (minio.ObjectInfo, error) {
			// Simulate MinIO NoSuchKey error
			return minio.ObjectInfo{}, minio.ErrorResponse{Code: "NoSuchKey", StatusCode: 404}
		},
	}

	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(mockQuerier, nil, mockStorage, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	body := `{"file_id": "` + fileID.String() + `"}`
	req, _ := http.NewRequest("POST", "/api/v1/files/confirm-upload", strings.NewReader(body))
	req.Header.Set("Authorization", generateAuthHeader(t, callerID, "user@nexus.internal", cfg.JWTSecret))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for NoSuchKey, got %d: %s", w.Code, w.Body.String())
	}
}

func TestFiles_ConfirmUpload_RogueFileCleanup(t *testing.T) {
	callerID := uuid.New()
	fileID := uuid.New()

	deletedFromStorage := false
	softDeletedInDB := false

	mockQuerier := &MockQuerier{
		GetFileByIDFn: func(ctx context.Context, id pgtype.UUID) (database.File, error) {
			return database.File{
				ID:         id,
				UploaderID: uuidToPg(callerID),
				Bucket:     "nexus-avatars",
				ObjectKey:  "avatars/123/avatar.png",
				Status:     "pending",
				SizeBytes:  1000,
			}, nil
		},
		SoftDeleteFileFn: func(ctx context.Context, id pgtype.UUID) error {
			softDeletedInDB = true
			return nil
		},
	}

	mockStorage := &MockStorageService{
		StatObjectFn: func(ctx context.Context, bucket, objectKey string) (minio.ObjectInfo, error) {
			// Client uploaded 10MB file directly to avatar bucket (limit is 5MB)
			return minio.ObjectInfo{
				Size:        10 * 1024 * 1024,
				ContentType: "image/png",
			}, nil
		},
		DeleteObjectFn: func(ctx context.Context, bucket, objectKey string) error {
			deletedFromStorage = true
			return nil
		},
	}

	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(mockQuerier, nil, mockStorage, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	body := `{"file_id": "` + fileID.String() + `"}`
	req, _ := http.NewRequest("POST", "/api/v1/files/confirm-upload", strings.NewReader(body))
	req.Header.Set("Authorization", generateAuthHeader(t, callerID, "user@nexus.internal", cfg.JWTSecret))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for oversized confirmed file, got %d: %s", w.Code, w.Body.String())
	}

	if !deletedFromStorage {
		t.Errorf("expected rogue object to be deleted from MinIO")
	}
	if !softDeletedInDB {
		t.Errorf("expected rogue file record to be soft deleted in PostgreSQL")
	}
}

func TestFiles_ConfirmUpload_FastPathIdempotency(t *testing.T) {
	callerID := uuid.New()
	fileID := uuid.New()

	statCalled := false

	mockQuerier := &MockQuerier{
		GetFileByIDFn: func(ctx context.Context, id pgtype.UUID) (database.File, error) {
			return database.File{
				ID:          id,
				UploaderID:  uuidToPg(callerID),
				Bucket:      "nexus-avatars",
				ObjectKey:   "avatars/123/avatar.png",
				Status:      "active", // Already confirmed!
				SizeBytes:   2048,
				ContentType: "image/png",
				FileName:    "avatar.png",
			}, nil
		},
	}

	mockStorage := &MockStorageService{
		StatObjectFn: func(ctx context.Context, bucket, objectKey string) (minio.ObjectInfo, error) {
			statCalled = true
			return minio.ObjectInfo{}, nil
		},
	}

	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(mockQuerier, nil, mockStorage, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	body := `{"file_id": "` + fileID.String() + `"}`
	req, _ := http.NewRequest("POST", "/api/v1/files/confirm-upload", strings.NewReader(body))
	req.Header.Set("Authorization", generateAuthHeader(t, callerID, "user@nexus.internal", cfg.JWTSecret))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for already active file, got %d: %s", w.Code, w.Body.String())
	}

	if statCalled {
		t.Errorf("fast-path idempotency should NOT re-invoke StatObject on active file")
	}
}

func TestFiles_DownloadAuthorization(t *testing.T) {
	callerID := uuid.New()
	fileID := uuid.New()
	chatID := uuid.New()
	groupID := uuid.New()

	// Case 1: Caller is NOT a member of chat's group
	mockQuerierNotMember := &MockQuerier{
		GetFileByIDFn: func(ctx context.Context, id pgtype.UUID) (database.File, error) {
			return database.File{
				ID:          id,
				ChatID:      uuidToPg(chatID),
				Bucket:      "nexus-attachments",
				ObjectKey:   "attachments/123/file.pdf",
				Status:      "active",
				FileName:    "file.pdf",
				ContentType: "application/pdf",
			}, nil
		},
		GetChatByIDFn: func(ctx context.Context, id pgtype.UUID) (database.Chat, error) {
			return database.Chat{ID: id, GroupID: uuidToPg(groupID)}, nil
		},
		GetGroupMemberFn: func(ctx context.Context, arg database.GetGroupMemberParams) (database.GroupMember, error) {
			return database.GroupMember{}, errors.New("not member")
		},
	}

	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h1 := New(mockQuerierNotMember, nil, &MockStorageService{}, nil, cfg)

	router1 := setupTestRouter()
	h1.RegisterRoutes(router1)

	req1, _ := http.NewRequest("GET", "/api/v1/files/"+fileID.String()+"/download?redirect=false", nil)
	req1.Header.Set("Authorization", generateAuthHeader(t, callerID, "user@nexus.internal", cfg.JWTSecret))
	w1 := httptest.NewRecorder()
	router1.ServeHTTP(w1, req1)

	if w1.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for unauthorized download, got %d", w1.Code)
	}

	// Case 2: Caller IS a member -> succeeds
	mockQuerierMember := &MockQuerier{
		GetFileByIDFn: func(ctx context.Context, id pgtype.UUID) (database.File, error) {
			return database.File{
				ID:          id,
				ChatID:      uuidToPg(chatID),
				Bucket:      "nexus-attachments",
				ObjectKey:   "attachments/123/file.pdf",
				Status:      "active",
				FileName:    "file.pdf",
				ContentType: "application/pdf",
			}, nil
		},
		GetChatByIDFn: func(ctx context.Context, id pgtype.UUID) (database.Chat, error) {
			return database.Chat{ID: id, GroupID: uuidToPg(groupID)}, nil
		},
		GetGroupMemberFn: func(ctx context.Context, arg database.GetGroupMemberParams) (database.GroupMember, error) {
			return database.GroupMember{GroupID: uuidToPg(groupID), UserID: uuidToPg(callerID)}, nil
		},
	}

	h2 := New(mockQuerierMember, nil, &MockStorageService{}, nil, cfg)
	router2 := setupTestRouter()
	h2.RegisterRoutes(router2)

	req2, _ := http.NewRequest("GET", "/api/v1/files/"+fileID.String()+"/download?redirect=false", nil)
	req2.Header.Set("Authorization", generateAuthHeader(t, callerID, "user@nexus.internal", cfg.JWTSecret))
	w2 := httptest.NewRecorder()
	router2.ServeHTTP(w2, req2)

	if w2.Code != http.StatusOK {
		t.Errorf("expected 200 OK for authorized download, got %d: %s", w2.Code, w2.Body.String())
	}
}
