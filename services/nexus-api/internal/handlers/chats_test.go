package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"nexus/nexus-api/internal/config"
	"nexus/nexus-api/internal/database"
)

func TestChats_Create(t *testing.T) {
	cfg := &config.Config{JWTSecret: "test-secret-12345"}
	callerID := uuid.New()
	tenantID := uuid.New()
	wsID := uuid.New()
	groupID := uuid.New()
	chatID := uuid.New()

	t.Run("success: creates chat in group", func(t *testing.T) {
		mockQ := &MockQuerier{
			GetGroupByIDFn: func(ctx context.Context, id pgtype.UUID) (database.Group, error) {
				return database.Group{
					ID:          uuidToPg(groupID),
					TenantID:    uuidToPg(tenantID),
					WorkspaceID: uuidToPg(wsID),
				}, nil
			},
			GetGroupMemberFn: func(ctx context.Context, arg database.GetGroupMemberParams) (database.GroupMember, error) {
				return database.GroupMember{Role: "member"}, nil
			},
			CreateChatFn: func(ctx context.Context, arg database.CreateChatParams) (database.Chat, error) {
				if arg.Title != "Frontend Sync" {
					t.Errorf("expected title 'Frontend Sync', got %q", arg.Title)
				}
				return database.Chat{
					ID:          uuidToPg(chatID),
					TenantID:    arg.TenantID,
					WorkspaceID: arg.WorkspaceID,
					GroupID:     arg.GroupID,
					Title:       arg.Title,
					CreatedAt:   pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
				}, nil
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		payload := CreateChatRequest{
			GroupID: groupID.String(),
			Title:   "Frontend Sync",
		}
		b, _ := json.Marshal(payload)
		req, _ := http.NewRequest(http.MethodPost, "/api/chats", bytes.NewReader(b))
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusCreated {
			t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
		}

		var resp map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		chatObj := resp["chat"].(map[string]interface{})
		if chatObj["title"] != "Frontend Sync" {
			t.Errorf("expected title 'Frontend Sync', got %v", chatObj["title"])
		}
	})

	t.Run("forbidden: caller is not a group member", func(t *testing.T) {
		mockQ := &MockQuerier{
			GetGroupByIDFn: func(ctx context.Context, id pgtype.UUID) (database.Group, error) {
				return database.Group{ID: uuidToPg(groupID)}, nil
			},
			GetGroupMemberFn: func(ctx context.Context, arg database.GetGroupMemberParams) (database.GroupMember, error) {
				return database.GroupMember{}, errors.New("not member")
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		payload := CreateChatRequest{
			GroupID: groupID.String(),
			Title:   "Unauthorized Chat",
		}
		b, _ := json.Marshal(payload)
		req, _ := http.NewRequest(http.MethodPost, "/api/chats", bytes.NewReader(b))
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden, got %d", w.Code)
		}
	})

	t.Run("not found: group does not exist", func(t *testing.T) {
		mockQ := &MockQuerier{
			GetGroupByIDFn: func(ctx context.Context, id pgtype.UUID) (database.Group, error) {
				return database.Group{}, errors.New("no rows")
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		payload := CreateChatRequest{
			GroupID: groupID.String(),
			Title:   "Ghost Chat",
		}
		b, _ := json.Marshal(payload)
		req, _ := http.NewRequest(http.MethodPost, "/api/chats", bytes.NewReader(b))
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404 Not Found, got %d", w.Code)
		}
	})
}

func TestChats_List(t *testing.T) {
	cfg := &config.Config{JWTSecret: "test-secret-12345"}
	callerID := uuid.New()
	groupID := uuid.New()

	t.Run("success: returns chats for group", func(t *testing.T) {
		mockQ := &MockQuerier{
			GetGroupMemberFn: func(ctx context.Context, arg database.GetGroupMemberParams) (database.GroupMember, error) {
				return database.GroupMember{Role: "member"}, nil
			},
			ListChatsByGroupFn: func(ctx context.Context, gID pgtype.UUID) ([]database.Chat, error) {
				return []database.Chat{
					{ID: uuidToPg(uuid.New()), Title: "General"},
					{ID: uuidToPg(uuid.New()), Title: "Announcements"},
				}, nil
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		req, _ := http.NewRequest(http.MethodGet, "/api/chats?group_id="+groupID.String(), nil)
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
		}

		var resp map[string][]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		if len(resp["chats"]) != 2 {
			t.Errorf("expected 2 chats, got %d", len(resp["chats"]))
		}
	})

	t.Run("missing group_id query param: 400 Bad Request", func(t *testing.T) {
		h := New(&MockQuerier{}, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		req, _ := http.NewRequest(http.MethodGet, "/api/chats", nil)
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request, got %d", w.Code)
		}
	})

	t.Run("forbidden: caller is not group member", func(t *testing.T) {
		mockQ := &MockQuerier{
			GetGroupMemberFn: func(ctx context.Context, arg database.GetGroupMemberParams) (database.GroupMember, error) {
				return database.GroupMember{}, errors.New("denied")
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		req, _ := http.NewRequest(http.MethodGet, "/api/chats?group_id="+groupID.String(), nil)
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden, got %d", w.Code)
		}
	})
}

func TestChats_MessagesAndThreads(t *testing.T) {
	cfg := &config.Config{JWTSecret: "test-secret-12345"}
	callerID := uuid.New()
	chatID := uuid.New()
	messageID := uuid.New()

	t.Run("list messages with reactions and thread metadata", func(t *testing.T) {
		reactionsJSON, _ := json.Marshal(map[string][]string{
			"👍": {"caller@nexus.local"},
		})
		replyToJSON, _ := json.Marshal(map[string]interface{}{
			"id": uuid.New().String(),
		})

		mockQ := &MockQuerier{
			ListMessagesByChatFn: func(ctx context.Context, arg database.ListMessagesByChatParams) ([]database.ListMessagesByChatRow, error) {
				return []database.ListMessagesByChatRow{
					{
						ID:                 uuidToPg(messageID),
						ChatID:             arg.ChatID,
						Content:            "Hello world message",
						Role:               "user",
						UserEmail:          textPg("caller@nexus.local"),
						DisplayName:        textPg("Caller User"),
						Reactions:          reactionsJSON,
						ReplyTo:            replyToJSON,
						ThreadCount:        2,
						ThreadLastReplyAt:  pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
						CreatedAt:          pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
						UpdatedAt:          pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
					},
				}, nil
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		req, _ := http.NewRequest(http.MethodGet, "/api/chats/"+chatID.String()+"/messages?limit=25&offset=0", nil)
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
		}

		var resp map[string][]map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		msgs := resp["messages"]
		if len(msgs) != 1 {
			t.Fatalf("expected 1 message, got %d", len(msgs))
		}
		if msgs[0]["content"] != "Hello world message" {
			t.Errorf("expected content 'Hello world message', got %v", msgs[0]["content"])
		}
		if msgs[0]["thread_count"].(float64) != 2 {
			t.Errorf("expected thread_count 2, got %v", msgs[0]["thread_count"])
		}
	})

	t.Run("get message thread replies", func(t *testing.T) {
		mockQ := &MockQuerier{
			ListThreadMessagesFn: func(ctx context.Context, parentID pgtype.UUID) ([]database.ListThreadMessagesRow, error) {
				return []database.ListThreadMessagesRow{
					{
						ID:         uuidToPg(uuid.New()),
						Content:    "Thread reply 1",
						UserEmail:  "reply@nexus.local",
						UserName:   "Reply User",
						UserAvatar: "http://minio/avatar.png",
						CreatedAt:  pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
					},
				}, nil
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		req, _ := http.NewRequest(http.MethodGet, "/api/messages/"+messageID.String()+"/thread", nil)
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
		}

		var resp map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		replies := resp["replies"].([]interface{})
		if len(replies) != 1 {
			t.Fatalf("expected 1 reply, got %d", len(replies))
		}
	})

	t.Run("list messages: database error", func(t *testing.T) {
		mockQ := &MockQuerier{
			ListMessagesByChatFn: func(ctx context.Context, arg database.ListMessagesByChatParams) ([]database.ListMessagesByChatRow, error) {
				return nil, errors.New("db connection timeout")
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		req, _ := http.NewRequest(http.MethodGet, "/api/chats/"+chatID.String()+"/messages", nil)
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500 Internal Server Error, got %d", w.Code)
		}
	})
}
