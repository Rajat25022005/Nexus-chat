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

func TestGroups_Create(t *testing.T) {
	cfg := &config.Config{JWTSecret: "test-secret-12345"}
	callerID := uuid.New()
	tenantID := uuid.New()
	wsID := uuid.New()
	groupID := uuid.New()

	t.Run("success: explicit tenant and workspace", func(t *testing.T) {
		var auditAction string
		mockQ := &MockQuerier{
			CreateGroupFn: func(ctx context.Context, arg database.CreateGroupParams) (database.Group, error) {
				return database.Group{
					ID:          uuidToPg(groupID),
					TenantID:    arg.TenantID,
					WorkspaceID: arg.WorkspaceID,
					Name:        arg.Name,
					OwnerID:     arg.OwnerID,
					InviteCode:  arg.InviteCode,
					CreatedAt:   pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
				}, nil
			},
			AddGroupMemberFn: func(ctx context.Context, arg database.AddGroupMemberParams) error {
				return nil
			},
			CreateChatFn: func(ctx context.Context, arg database.CreateChatParams) (database.Chat, error) {
				return database.Chat{
					ID:          uuidToPg(uuid.New()),
					TenantID:    arg.TenantID,
					WorkspaceID: arg.WorkspaceID,
					GroupID:     arg.GroupID,
					Title:       arg.Title,
				}, nil
			},
			InsertAuditLogFn: func(ctx context.Context, arg database.InsertAuditLogParams) error {
				auditAction = arg.Action
				return nil
			},
			ListGroupMembersFn: func(ctx context.Context, groupID pgtype.UUID) ([]database.ListGroupMembersRow, error) {
				return []database.ListGroupMembersRow{
					{UserID: uuidToPg(callerID), Email: "caller@nexus.local", Role: "owner"},
				}, nil
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		payload := CreateGroupRequest{
			TenantID:    tenantID.String(),
			WorkspaceID: wsID.String(),
			Name:        "Backend Engineers",
			AIEnabled:   true,
		}
		b, _ := json.Marshal(payload)
		req, _ := http.NewRequest(http.MethodPost, "/api/groups", bytes.NewReader(b))
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusCreated {
			t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
		}
		if auditAction != "group.created" {
			t.Errorf("expected audit action 'group.created', got %q", auditAction)
		}

		var resp map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		groupObj := resp["group"].(map[string]interface{})
		if groupObj["name"] != "Backend Engineers" {
			t.Errorf("expected group name 'Backend Engineers', got %v", groupObj["name"])
		}
	})

	t.Run("success: default workspace fallback", func(t *testing.T) {
		mockQ := &MockQuerier{
			ListWorkspacesByUserFn: func(ctx context.Context, userID pgtype.UUID) ([]database.Workspace, error) {
				return []database.Workspace{
					{ID: uuidToPg(wsID), TenantID: uuidToPg(tenantID), Name: "Default WS"},
				}, nil
			},
			CreateGroupFn: func(ctx context.Context, arg database.CreateGroupParams) (database.Group, error) {
				return database.Group{
					ID:          uuidToPg(groupID),
					TenantID:    arg.TenantID,
					WorkspaceID: arg.WorkspaceID,
					Name:        arg.Name,
					OwnerID:     arg.OwnerID,
					CreatedAt:   pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
				}, nil
			},
			AddGroupMemberFn: func(ctx context.Context, arg database.AddGroupMemberParams) error {
				return nil
			},
			CreateChatFn: func(ctx context.Context, arg database.CreateChatParams) (database.Chat, error) {
				return database.Chat{ID: uuidToPg(uuid.New()), Title: "General"}, nil
			},
			InsertAuditLogFn: func(ctx context.Context, arg database.InsertAuditLogParams) error {
				return nil
			},
			ListGroupMembersFn: func(ctx context.Context, groupID pgtype.UUID) ([]database.ListGroupMembersRow, error) {
				return nil, nil
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		payload := CreateGroupRequest{Name: "Fallback Group"}
		b, _ := json.Marshal(payload)
		req, _ := http.NewRequest(http.MethodPost, "/api/groups", bytes.NewReader(b))
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusCreated {
			t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("failure: user has no workspaces", func(t *testing.T) {
		mockQ := &MockQuerier{
			ListWorkspacesByUserFn: func(ctx context.Context, userID pgtype.UUID) ([]database.Workspace, error) {
				return nil, nil
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		payload := CreateGroupRequest{Name: "Orphan Group"}
		b, _ := json.Marshal(payload)
		req, _ := http.NewRequest(http.MethodPost, "/api/groups", bytes.NewReader(b))
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500 Internal Server Error, got %d", w.Code)
		}
	})
}

func TestGroups_List(t *testing.T) {
	cfg := &config.Config{JWTSecret: "test-secret-12345"}
	callerID := uuid.New()
	groupID := uuid.New()

	t.Run("list existing groups with chats and members", func(t *testing.T) {
		mockQ := &MockQuerier{
			ListGroupsByUserFn: func(ctx context.Context, userID pgtype.UUID) ([]database.Group, error) {
				return []database.Group{
					{
						ID:        uuidToPg(groupID),
						Name:      "Design Team",
						CreatedAt: pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
					},
				}, nil
			},
			ListChatsByGroupFn: func(ctx context.Context, groupID pgtype.UUID) ([]database.Chat, error) {
				return []database.Chat{
					{ID: uuidToPg(uuid.New()), Title: "UI/UX"},
				}, nil
			},
			ListGroupMembersFn: func(ctx context.Context, groupID pgtype.UUID) ([]database.ListGroupMembersRow, error) {
				return []database.ListGroupMembersRow{
					{Email: "alice@nexus.local"},
				}, nil
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		req, _ := http.NewRequest(http.MethodGet, "/api/groups", nil)
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
		}

		var resp map[string][]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		if len(resp["groups"]) != 1 {
			t.Errorf("expected 1 group, got %d", len(resp["groups"]))
		}
	})

	t.Run("auto-provision default group if empty", func(t *testing.T) {
		wsID := uuid.New()
		tenantID := uuid.New()
		var autoCreated bool

		mockQ := &MockQuerier{
			ListGroupsByUserFn: func(ctx context.Context, userID pgtype.UUID) ([]database.Group, error) {
				return nil, nil
			},
			ListWorkspacesByUserFn: func(ctx context.Context, userID pgtype.UUID) ([]database.Workspace, error) {
				return []database.Workspace{
					{ID: uuidToPg(wsID), TenantID: uuidToPg(tenantID), Name: "Main Workspace"},
				}, nil
			},
			CreateGroupFn: func(ctx context.Context, arg database.CreateGroupParams) (database.Group, error) {
				autoCreated = true
				return database.Group{
					ID:          uuidToPg(groupID),
					TenantID:    arg.TenantID,
					WorkspaceID: arg.WorkspaceID,
					Name:        arg.Name,
					OwnerID:     arg.OwnerID,
					CreatedAt:   pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
				}, nil
			},
			AddGroupMemberFn: func(ctx context.Context, arg database.AddGroupMemberParams) error {
				return nil
			},
			CreateChatFn: func(ctx context.Context, arg database.CreateChatParams) (database.Chat, error) {
				return database.Chat{ID: uuidToPg(uuid.New()), Title: "general"}, nil
			},
			ListChatsByGroupFn: func(ctx context.Context, groupID pgtype.UUID) ([]database.Chat, error) {
				return nil, nil
			},
			ListGroupMembersFn: func(ctx context.Context, groupID pgtype.UUID) ([]database.ListGroupMembersRow, error) {
				return nil, nil
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		req, _ := http.NewRequest(http.MethodGet, "/api/groups", nil)
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d", w.Code)
		}
		if !autoCreated {
			t.Errorf("expected auto-provision of General group when list is empty")
		}
	})
}

func TestGroups_Join(t *testing.T) {
	cfg := &config.Config{JWTSecret: "test-secret-12345"}
	callerID := uuid.New()
	groupID := uuid.New()
	wsID := uuid.New()

	t.Run("success: join with valid invite code", func(t *testing.T) {
		var memberAdded bool
		mockQ := &MockQuerier{
			GetGroupByInviteCodeFn: func(ctx context.Context, inviteCode pgtype.Text) (database.Group, error) {
				return database.Group{
					ID:          uuidToPg(groupID),
					WorkspaceID: uuidToPg(wsID),
					Name:        "Secret Club",
					CreatedAt:   pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
				}, nil
			},
			GetGroupMemberFn: func(ctx context.Context, arg database.GetGroupMemberParams) (database.GroupMember, error) {
				return database.GroupMember{}, errors.New("not member")
			},
			AddGroupMemberFn: func(ctx context.Context, arg database.AddGroupMemberParams) error {
				memberAdded = true
				return nil
			},
			AddWorkspaceMemberFn: func(ctx context.Context, arg database.AddWorkspaceMemberParams) error {
				return nil
			},
			InsertAuditLogFn: func(ctx context.Context, arg database.InsertAuditLogParams) error {
				return nil
			},
			ListChatsByGroupFn: func(ctx context.Context, groupID pgtype.UUID) ([]database.Chat, error) {
				return nil, nil
			},
			ListGroupMembersFn: func(ctx context.Context, groupID pgtype.UUID) ([]database.ListGroupMembersRow, error) {
				return nil, nil
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		payload := `{"code":"ABCD-1234"}`
		req, _ := http.NewRequest(http.MethodPost, "/api/groups/join", bytes.NewReader([]byte(payload)))
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
		}
		if !memberAdded {
			t.Errorf("expected member to be added to group")
		}
	})

	t.Run("already a member: returns group idempotently", func(t *testing.T) {
		mockQ := &MockQuerier{
			GetGroupByInviteCodeFn: func(ctx context.Context, inviteCode pgtype.Text) (database.Group, error) {
				return database.Group{
					ID:          uuidToPg(groupID),
					WorkspaceID: uuidToPg(wsID),
					Name:        "Existing Group",
					CreatedAt:   pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
				}, nil
			},
			GetGroupMemberFn: func(ctx context.Context, arg database.GetGroupMemberParams) (database.GroupMember, error) {
				return database.GroupMember{Role: "member"}, nil
			},
			ListChatsByGroupFn: func(ctx context.Context, groupID pgtype.UUID) ([]database.Chat, error) {
				return nil, nil
			},
			ListGroupMembersFn: func(ctx context.Context, groupID pgtype.UUID) ([]database.ListGroupMembersRow, error) {
				return nil, nil
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		payload := `{"code":"ABCD-1234"}`
		req, _ := http.NewRequest(http.MethodPost, "/api/groups/join", bytes.NewReader([]byte(payload)))
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for existing member, got %d", w.Code)
		}
	})

	t.Run("invalid invite code: not found", func(t *testing.T) {
		mockQ := &MockQuerier{
			GetGroupByInviteCodeFn: func(ctx context.Context, inviteCode pgtype.Text) (database.Group, error) {
				return database.Group{}, errors.New("no rows")
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		payload := `{"code":"INVALID"}`
		req, _ := http.NewRequest(http.MethodPost, "/api/groups/join", bytes.NewReader([]byte(payload)))
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404 Not Found, got %d", w.Code)
		}
	})
}

func TestGroups_Delete(t *testing.T) {
	cfg := &config.Config{JWTSecret: "test-secret-12345"}
	ownerID := uuid.New()
	otherUserID := uuid.New()
	groupID := uuid.New()

	t.Run("success: owner soft-deletes group", func(t *testing.T) {
		var softDeleted bool
		mockQ := &MockQuerier{
			GetGroupByIDFn: func(ctx context.Context, id pgtype.UUID) (database.Group, error) {
				return database.Group{ID: uuidToPg(groupID), OwnerID: uuidToPg(ownerID)}, nil
			},
			SoftDeleteGroupFn: func(ctx context.Context, arg database.SoftDeleteGroupParams) error {
				softDeleted = true
				return nil
			},
			InsertAuditLogFn: func(ctx context.Context, arg database.InsertAuditLogParams) error {
				return nil
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		req, _ := http.NewRequest(http.MethodDelete, "/api/groups/"+groupID.String(), nil)
		req.Header.Set("Authorization", generateAuthHeader(t, ownerID, "owner@nexus.local", cfg.JWTSecret))

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
		}
		if !softDeleted {
			t.Errorf("expected SoftDeleteGroup to be executed")
		}
	})

	t.Run("forbidden: non-owner cannot delete group", func(t *testing.T) {
		mockQ := &MockQuerier{
			GetGroupByIDFn: func(ctx context.Context, id pgtype.UUID) (database.Group, error) {
				return database.Group{ID: uuidToPg(groupID), OwnerID: uuidToPg(ownerID)}, nil
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		req, _ := http.NewRequest(http.MethodDelete, "/api/groups/"+groupID.String(), nil)
		req.Header.Set("Authorization", generateAuthHeader(t, otherUserID, "other@nexus.local", cfg.JWTSecret))

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

		req, _ := http.NewRequest(http.MethodDelete, "/api/groups/"+groupID.String(), nil)
		req.Header.Set("Authorization", generateAuthHeader(t, ownerID, "owner@nexus.local", cfg.JWTSecret))

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404 Not Found, got %d", w.Code)
		}
	})
}
