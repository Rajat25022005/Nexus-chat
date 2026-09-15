package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"nexus/nexus-api/internal/config"
	"nexus/nexus-api/internal/database"
)

func TestWorkspaces_Create(t *testing.T) {
	cfg := &config.Config{JWTSecret: "test-secret-12345"}
	callerID := uuid.New()
	tenantID := uuid.New()
	wsID := uuid.New()

	t.Run("success: creates workspace and adds owner", func(t *testing.T) {
		var addedOwnerRole string
		mockQ := &MockQuerier{
			CreateWorkspaceFn: func(ctx context.Context, arg database.CreateWorkspaceParams) (database.Workspace, error) {
				if arg.Name != "Engineering" || arg.Slug != "engineering" {
					t.Errorf("unexpected params: %+v", arg)
				}
				return database.Workspace{
					ID:       uuidToPg(wsID),
					TenantID: arg.TenantID,
					Name:     arg.Name,
					Slug:     arg.Slug,
				}, nil
			},
			AddWorkspaceMemberFn: func(ctx context.Context, arg database.AddWorkspaceMemberParams) error {
				addedOwnerRole = arg.Role
				return nil
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		payload := CreateWorkspaceRequest{
			TenantID: tenantID.String(),
			Name:     "Engineering",
			Slug:     "engineering",
		}
		body, _ := json.Marshal(payload)
		req, _ := http.NewRequest(http.MethodPost, "/api/workspaces", bytes.NewReader(body))
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusCreated {
			t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
		}
		if addedOwnerRole != "owner" {
			t.Errorf("expected added role to be 'owner', got %q", addedOwnerRole)
		}
	})

	t.Run("unauthorized: missing token", func(t *testing.T) {
		h := New(&MockQuerier{}, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		payload := `{"tenant_id":"` + tenantID.String() + `","name":"W1","slug":"w1"}`
		req, _ := http.NewRequest(http.MethodPost, "/api/workspaces", bytes.NewReader([]byte(payload)))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d", w.Code)
		}
	})

	t.Run("bad request: invalid tenant UUID format", func(t *testing.T) {
		h := New(&MockQuerier{}, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		payload := `{"tenant_id":"invalid-uuid","name":"W1","slug":"w1"}`
		req, _ := http.NewRequest(http.MethodPost, "/api/workspaces", bytes.NewReader([]byte(payload)))
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request, got %d", w.Code)
		}
	})

	t.Run("database error on create", func(t *testing.T) {
		mockQ := &MockQuerier{
			CreateWorkspaceFn: func(ctx context.Context, arg database.CreateWorkspaceParams) (database.Workspace, error) {
				return database.Workspace{}, errors.New("unique constraint violation")
			},
		}
		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		payload := `{"tenant_id":"` + tenantID.String() + `","name":"W1","slug":"w1"}`
		req, _ := http.NewRequest(http.MethodPost, "/api/workspaces", bytes.NewReader([]byte(payload)))
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500 Internal Server Error, got %d", w.Code)
		}
	})
}

func TestWorkspaces_List(t *testing.T) {
	cfg := &config.Config{JWTSecret: "test-secret-12345"}
	callerID := uuid.New()
	tenantID := uuid.New()

	t.Run("list workspaces by user (no tenant_id param)", func(t *testing.T) {
		mockQ := &MockQuerier{
			ListWorkspacesByUserFn: func(ctx context.Context, userID pgtype.UUID) ([]database.Workspace, error) {
				return []database.Workspace{
					{ID: uuidToPg(uuid.New()), Name: "Workspace 1", Slug: "ws1"},
					{ID: uuidToPg(uuid.New()), Name: "Workspace 2", Slug: "ws2"},
				}, nil
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		req, _ := http.NewRequest(http.MethodGet, "/api/workspaces", nil)
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d", w.Code)
		}

		var resp map[string][]database.Workspace
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		if len(resp["workspaces"]) != 2 {
			t.Errorf("expected 2 workspaces, got %d", len(resp["workspaces"]))
		}
	})

	t.Run("list workspaces by tenant (with tenant_id param)", func(t *testing.T) {
		mockQ := &MockQuerier{
			ListWorkspacesByTenantFn: func(ctx context.Context, arg database.ListWorkspacesByTenantParams) ([]database.Workspace, error) {
				return []database.Workspace{
					{ID: uuidToPg(uuid.New()), Name: "Tenant WS", Slug: "tenant-ws"},
				}, nil
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		req, _ := http.NewRequest(http.MethodGet, "/api/workspaces?tenant_id="+tenantID.String(), nil)
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d", w.Code)
		}

		var resp map[string][]database.Workspace
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		if len(resp["workspaces"]) != 1 {
			t.Errorf("expected 1 workspace, got %d", len(resp["workspaces"]))
		}
	})

	t.Run("bad request: invalid tenant_id query param", func(t *testing.T) {
		h := New(&MockQuerier{}, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		req, _ := http.NewRequest(http.MethodGet, "/api/workspaces?tenant_id=not-a-uuid", nil)
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request, got %d", w.Code)
		}
	})
}

func TestWorkspaces_Get(t *testing.T) {
	cfg := &config.Config{JWTSecret: "test-secret-12345"}
	callerID := uuid.New()
	wsID := uuid.New()

	t.Run("success: returns workspace for valid member", func(t *testing.T) {
		mockQ := &MockQuerier{
			GetWorkspaceMemberFn: func(ctx context.Context, arg database.GetWorkspaceMemberParams) (database.WorkspaceMember, error) {
				return database.WorkspaceMember{Role: "member"}, nil
			},
			GetWorkspaceByIDFn: func(ctx context.Context, id pgtype.UUID) (database.Workspace, error) {
				return database.Workspace{ID: uuidToPg(wsID), Name: "Design Workspace"}, nil
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		req, _ := http.NewRequest(http.MethodGet, "/api/workspaces/"+wsID.String(), nil)
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("forbidden: caller is not a member", func(t *testing.T) {
		mockQ := &MockQuerier{
			GetWorkspaceMemberFn: func(ctx context.Context, arg database.GetWorkspaceMemberParams) (database.WorkspaceMember, error) {
				return database.WorkspaceMember{}, errors.New("not found")
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		req, _ := http.NewRequest(http.MethodGet, "/api/workspaces/"+wsID.String(), nil)
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden, got %d", w.Code)
		}
	})

	t.Run("not found: workspace record missing", func(t *testing.T) {
		mockQ := &MockQuerier{
			GetWorkspaceMemberFn: func(ctx context.Context, arg database.GetWorkspaceMemberParams) (database.WorkspaceMember, error) {
				return database.WorkspaceMember{Role: "member"}, nil
			},
			GetWorkspaceByIDFn: func(ctx context.Context, id pgtype.UUID) (database.Workspace, error) {
				return database.Workspace{}, errors.New("no rows")
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		req, _ := http.NewRequest(http.MethodGet, "/api/workspaces/"+wsID.String(), nil)
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404 Not Found, got %d", w.Code)
		}
	})
}

func TestWorkspaces_Members(t *testing.T) {
	cfg := &config.Config{JWTSecret: "test-secret-12345"}
	callerID := uuid.New()
	wsID := uuid.New()
	targetUserID := uuid.New()

	t.Run("list members success", func(t *testing.T) {
		mockQ := &MockQuerier{
			GetWorkspaceMemberFn: func(ctx context.Context, arg database.GetWorkspaceMemberParams) (database.WorkspaceMember, error) {
				return database.WorkspaceMember{Role: "member"}, nil
			},
			ListWorkspaceMembersFn: func(ctx context.Context, workspaceID pgtype.UUID) ([]database.ListWorkspaceMembersRow, error) {
				return []database.ListWorkspaceMembersRow{
					{UserID: uuidToPg(callerID), Email: "caller@nexus.local", Role: "member"},
				}, nil
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		req, _ := http.NewRequest(http.MethodGet, "/api/workspaces/"+wsID.String()+"/members", nil)
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("add member: caller is owner -> success", func(t *testing.T) {
		mockQ := &MockQuerier{
			GetWorkspaceMemberFn: func(ctx context.Context, arg database.GetWorkspaceMemberParams) (database.WorkspaceMember, error) {
				return database.WorkspaceMember{Role: "owner"}, nil
			},
			AddWorkspaceMemberFn: func(ctx context.Context, arg database.AddWorkspaceMemberParams) error {
				if arg.Role != "admin" {
					t.Errorf("expected role admin, got %s", arg.Role)
				}
				return nil
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		payload := AddWorkspaceMemberRequest{
			UserID: targetUserID.String(),
			Role:   "admin",
		}
		b, _ := json.Marshal(payload)
		req, _ := http.NewRequest(http.MethodPost, "/api/workspaces/"+wsID.String()+"/members", bytes.NewReader(b))
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusCreated {
			t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("add member: caller is member -> forbidden", func(t *testing.T) {
		mockQ := &MockQuerier{
			GetWorkspaceMemberFn: func(ctx context.Context, arg database.GetWorkspaceMemberParams) (database.WorkspaceMember, error) {
				return database.WorkspaceMember{Role: "member"}, nil
			},
		}

		h := New(mockQ, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		payload := AddWorkspaceMemberRequest{
			UserID: targetUserID.String(),
			Role:   "member",
		}
		b, _ := json.Marshal(payload)
		req, _ := http.NewRequest(http.MethodPost, "/api/workspaces/"+wsID.String()+"/members", bytes.NewReader(b))
		req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.local", cfg.JWTSecret))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden, got %d", w.Code)
		}
	})
}
