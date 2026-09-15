package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"nexus/nexus-api/internal/config"
	"nexus/nexus-api/internal/database"
	"nexus/nexus-api/internal/services"
)

func TestDirectChat_SelfChatRejection(t *testing.T) {
	callerID := uuid.New()
	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(&MockQuerier{}, nil, nil, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	body := `{"recipient_id": "` + callerID.String() + `"}`
	req, _ := http.NewRequest("POST", "/api/v1/chats/direct", strings.NewReader(body))
	req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.internal", cfg.JWTSecret))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400 for self chat, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDirectChat_BlockedUserRejection(t *testing.T) {
	callerID := uuid.New()
	recipientID := uuid.New()

	mockQuerier := &MockQuerier{
		GetUserByIDFn: func(ctx context.Context, id pgtype.UUID) (database.User, error) {
			return database.User{
				ID:          uuidToPg(recipientID),
				DisplayName: "Target User",
			}, nil
		},
		CheckUsersBlockedFn: func(ctx context.Context, arg database.CheckUsersBlockedParams) (bool, error) {
			return true, nil // blocked!
		},
	}

	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(mockQuerier, nil, nil, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	body := `{"recipient_id": "` + recipientID.String() + `"}`
	req, _ := http.NewRequest("POST", "/api/v1/chats/direct", strings.NewReader(body))
	req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.internal", cfg.JWTSecret))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected status 403 for blocked user, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDirectChat_ExistingChatIdempotency(t *testing.T) {
	callerID := uuid.New()
	recipientID := uuid.New()
	existingChatID := uuid.New()
	existingDCID := uuid.New()

	mockQuerier := &MockQuerier{
		GetUserByIDFn: func(ctx context.Context, id pgtype.UUID) (database.User, error) {
			return database.User{
				ID:          uuidToPg(recipientID),
				DisplayName: "Target User",
				Username:    textPg("targetuser"),
			}, nil
		},
		CheckUsersBlockedFn: func(ctx context.Context, arg database.CheckUsersBlockedParams) (bool, error) {
			return false, nil
		},
		GetDirectChatByUsersFn: func(ctx context.Context, arg database.GetDirectChatByUsersParams) (database.GetDirectChatByUsersRow, error) {
			return database.GetDirectChatByUsersRow{
				ID:        uuidToPg(existingDCID),
				ChatID:    uuidToPg(existingChatID),
				UserAID:   arg.UserAID,
				UserBID:   arg.UserBID,
				CreatedAt: pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
			}, nil
		},
	}

	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(mockQuerier, nil, nil, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	body := `{"recipient_id": "` + recipientID.String() + `"}`
	req, _ := http.NewRequest("POST", "/api/v1/chats/direct", strings.NewReader(body))
	req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.internal", cfg.JWTSecret))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200 OK for existing chat, got %d: %s", w.Code, w.Body.String())
	}

	var resp DirectChatResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode direct chat response: %v", err)
	}

	if resp.IsNew != false {
		t.Errorf("expected is_new == false, got %v", resp.IsNew)
	}
	if resp.ChatID != existingChatID {
		t.Errorf("expected chat_id %s, got %s", existingChatID, resp.ChatID)
	}
}

func TestDirectChat_ConcurrencyRaceRecovery23505(t *testing.T) {
	callerID := uuid.New()
	recipientID := uuid.New()
	winningChatID := uuid.New()
	winningDCID := uuid.New()

	lookupCount := 0

	mockQuerier := &MockQuerier{
		GetUserByIDFn: func(ctx context.Context, id pgtype.UUID) (database.User, error) {
			return database.User{
				ID:          uuidToPg(recipientID),
				DisplayName: "Target User",
			}, nil
		},
		CheckUsersBlockedFn: func(ctx context.Context, arg database.CheckUsersBlockedParams) (bool, error) {
			return false, nil
		},
		GetDirectChatByUsersFn: func(ctx context.Context, arg database.GetDirectChatByUsersParams) (database.GetDirectChatByUsersRow, error) {
			lookupCount++
			if lookupCount == 1 {
				// First check: no chat found
				return database.GetDirectChatByUsersRow{}, pgx.ErrNoRows
			}
			// Second check (recovery after 23505 collision): concurrent request created the winning chat!
			return database.GetDirectChatByUsersRow{
				ID:        uuidToPg(winningDCID),
				ChatID:    uuidToPg(winningChatID),
				UserAID:   arg.UserAID,
				UserBID:   arg.UserBID,
				CreatedAt: pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
			}, nil
		},
		GetCallerWorkspaceFn: func(ctx context.Context, callerID pgtype.UUID) (database.Workspace, error) {
			return database.Workspace{
				ID:       uuidToPg(uuid.New()),
				TenantID: uuidToPg(uuid.New()),
				Name:     "Test Workspace",
			}, nil
		},
		CreateDirectBackingGroupFn: func(ctx context.Context, arg database.CreateDirectBackingGroupParams) (database.Group, error) {
			return database.Group{ID: uuidToPg(uuid.New())}, nil
		},
		CreateChatFn: func(ctx context.Context, arg database.CreateChatParams) (database.Chat, error) {
			return database.Chat{ID: uuidToPg(uuid.New())}, nil
		},
		CreateDirectChatRegistryFn: func(ctx context.Context, arg database.CreateDirectChatRegistryParams) (database.DirectChat, error) {
			// Simulate PostgreSQL 23505 unique_violation on uq_direct_chat_pair
			return database.DirectChat{}, errors.New("ERROR: duplicate key value violates unique constraint \"uq_direct_chat_pair\" (SQLSTATE 23505)")
		},
	}

	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(mockQuerier, nil, nil, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	body := `{"recipient_id": "` + recipientID.String() + `"}`
	req, _ := http.NewRequest("POST", "/api/v1/chats/direct", strings.NewReader(body))
	req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.internal", cfg.JWTSecret))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Concurrency recovery must convert 23505 into HTTP 200 with is_new = false
	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200 OK after 23505 race recovery, got %d: %s", w.Code, w.Body.String())
	}

	var resp DirectChatResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode direct chat response: %v", err)
	}

	if resp.IsNew != false {
		t.Errorf("expected is_new == false after race recovery, got %v", resp.IsNew)
	}
	if resp.ChatID != winningChatID {
		t.Errorf("expected recovered winning chat_id %s, got %s", winningChatID, resp.ChatID)
	}
}

func TestDirectChat_NewCreationAndBroadcast(t *testing.T) {
	callerID := uuid.New()
	recipientID := uuid.New()
	newChatID := uuid.New()
	newDCID := uuid.New()

	var canonicalA, canonicalB pgtype.UUID
	if bytes.Compare(callerID[:], recipientID[:]) < 0 {
		canonicalA = uuidToPg(callerID)
		canonicalB = uuidToPg(recipientID)
	} else {
		canonicalA = uuidToPg(recipientID)
		canonicalB = uuidToPg(callerID)
	}

	broadcastTriggered := false
	var broadcastRecipient uuid.UUID

	mockBroadcaster := &MockBroadcaster{
		PublishDirectChatCreatedFn: func(ctx context.Context, recipientID uuid.UUID, payload services.DirectChatCreatedPayload) error {
			broadcastTriggered = true
			broadcastRecipient = recipientID
			if payload.ChatID != newChatID {
				t.Errorf("expected broadcast chat_id %s, got %s", newChatID, payload.ChatID)
			}
			return nil
		},
	}

	mockQuerier := &MockQuerier{
		GetUserByIDFn: func(ctx context.Context, id pgtype.UUID) (database.User, error) {
			return database.User{
				ID:          id,
				DisplayName: "User Name",
			}, nil
		},
		CheckUsersBlockedFn: func(ctx context.Context, arg database.CheckUsersBlockedParams) (bool, error) {
			return false, nil
		},
		GetDirectChatByUsersFn: func(ctx context.Context, arg database.GetDirectChatByUsersParams) (database.GetDirectChatByUsersRow, error) {
			return database.GetDirectChatByUsersRow{}, pgx.ErrNoRows
		},
		GetCallerWorkspaceFn: func(ctx context.Context, callerID pgtype.UUID) (database.Workspace, error) {
			return database.Workspace{
				ID:       uuidToPg(uuid.New()),
				TenantID: uuidToPg(uuid.New()),
				Name:     "Caller Workspace",
			}, nil
		},
		CreateDirectBackingGroupFn: func(ctx context.Context, arg database.CreateDirectBackingGroupParams) (database.Group, error) {
			return database.Group{ID: uuidToPg(uuid.New())}, nil
		},
		CreateChatFn: func(ctx context.Context, arg database.CreateChatParams) (database.Chat, error) {
			return database.Chat{ID: uuidToPg(newChatID)}, nil
		},
		CreateDirectChatRegistryFn: func(ctx context.Context, arg database.CreateDirectChatRegistryParams) (database.DirectChat, error) {
			// Verify canonical ordering
			if !bytes.Equal(arg.UserAID.Bytes[:], canonicalA.Bytes[:]) || !bytes.Equal(arg.UserBID.Bytes[:], canonicalB.Bytes[:]) {
				t.Errorf("canonical order mismatch: got (%s, %s), want (%s, %s)",
					formatUUID(arg.UserAID), formatUUID(arg.UserBID), formatUUID(canonicalA), formatUUID(canonicalB))
			}
			return database.DirectChat{
				ID:        uuidToPg(newDCID),
				ChatID:    uuidToPg(newChatID),
				UserAID:   arg.UserAID,
				UserBID:   arg.UserBID,
				CreatedAt: pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
			}, nil
		},
	}

	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(mockQuerier, nil, nil, mockBroadcaster, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	body := `{"recipient_id": "` + recipientID.String() + `"}`
	req, _ := http.NewRequest("POST", "/api/v1/chats/direct", strings.NewReader(body))
	req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.internal", cfg.JWTSecret))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected status 201 Created for new direct chat, got %d: %s", w.Code, w.Body.String())
	}

	var resp DirectChatResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.IsNew != true {
		t.Errorf("expected is_new == true for new direct chat, got %v", resp.IsNew)
	}
	if !broadcastTriggered {
		t.Errorf("expected Redis direct_chat_created broadcast to be published")
	}
	if broadcastRecipient != recipientID {
		t.Errorf("expected broadcast recipient %s, got %s", recipientID, broadcastRecipient)
	}
}
