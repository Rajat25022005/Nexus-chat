package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"nexus/nexus-api/internal/config"
)

func TestRouter_HealthCheckEndpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := &config.Config{
		JWTSecret: "test-secret-key-1234567890-test-key",
	}

	h := New(&MockQuerier{}, nil, &MockStorageService{}, nil, cfg)
	router := gin.New()
	h.RegisterRoutes(router)

	t.Run("GET /healthz returns 200 and healthy status", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d. Body: %s", rec.Code, rec.Body.String())
		}

		var body map[string]interface{}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("failed to decode JSON response: %v", err)
		}

		if body["status"] != "healthy" {
			t.Errorf("expected status 'healthy', got '%v'", body["status"])
		}
		if body["service"] != "nexus-api" {
			t.Errorf("expected service 'nexus-api', got '%v'", body["service"])
		}
		if body["time"] == nil {
			t.Errorf("expected timestamp field 'time' in response")
		}
	})

	t.Run("GET /health returns 200 and healthy status", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d. Body: %s", rec.Code, rec.Body.String())
		}

		var body map[string]interface{}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("failed to decode JSON response: %v", err)
		}

		if body["status"] != "healthy" {
			t.Errorf("expected status 'healthy', got '%v'", body["status"])
		}
	})

	t.Run("GET /live returns 200 alive", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/live", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", rec.Code)
		}
	})

	t.Run("GET /ready returns 200 ready when pool is nil", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/ready", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", rec.Code)
		}
	})

	t.Run("GET /favicon.ico returns 204 No Content", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/favicon.ico", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusNoContent {
			t.Fatalf("expected status 204, got %d", rec.Code)
		}
	})
}

func TestRouter_FullRouteTableVerification(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := &config.Config{
		JWTSecret: "test-secret-key-1234567890-test-key",
	}

	h := New(&MockQuerier{}, nil, &MockStorageService{}, nil, cfg)
	router := gin.New()
	h.RegisterRoutes(router)

	registeredRoutes := router.Routes()
	routeMap := make(map[string]bool)
	for _, route := range registeredRoutes {
		key := route.Method + " " + route.Path
		routeMap[key] = true
	}

	expectedRoutes := []struct {
		method string
		path   string
	}{
		// System & Probes
		{http.MethodGet, "/favicon.ico"},
		{http.MethodGet, "/health"},
		{http.MethodGet, "/healthz"},
		{http.MethodGet, "/live"},
		{http.MethodGet, "/ready"},

		// Public Auth
		{http.MethodPost, "/api/auth/register"},
		{http.MethodPost, "/api/auth/login"},

		// Protected Auth & Profile
		{http.MethodGet, "/api/auth/me"},
		{http.MethodPut, "/api/auth/profile"},
		{http.MethodPost, "/api/auth/profile/avatar"},

		// Protected Workspaces
		{http.MethodPost, "/api/workspaces"},
		{http.MethodGet, "/api/workspaces"},
		{http.MethodGet, "/api/workspaces/:id"},
		{http.MethodGet, "/api/workspaces/:id/members"},
		{http.MethodPost, "/api/workspaces/:id/members"},

		// Protected Groups
		{http.MethodPost, "/api/groups"},
		{http.MethodGet, "/api/groups"},
		{http.MethodPost, "/api/groups/join"},
		{http.MethodDelete, "/api/groups/:id"},

		// Protected Chats & Messages
		{http.MethodPost, "/api/chats"},
		{http.MethodGet, "/api/chats"},
		{http.MethodGet, "/api/chats/:id/messages"},
		{http.MethodGet, "/api/messages/:id/thread"},

		// API v1 Endpoints (Discovery, Direct Chats, S3 Lifecycle, Avatar)
		{http.MethodGet, "/api/v1/users/search"},
		{http.MethodPost, "/api/v1/chats/direct"},
		{http.MethodPost, "/api/v1/files/presign-upload"},
		{http.MethodPost, "/api/v1/files/confirm-upload"},
		{http.MethodGet, "/api/v1/files/:id/download"},
		{http.MethodPost, "/api/v1/users/avatar"},
	}

	for _, expected := range expectedRoutes {
		key := expected.method + " " + expected.path
		if !routeMap[key] {
			t.Errorf("missing expected route: %s", key)
		}
	}
}

func TestRouter_ProtectedEndpointsRequireAuth(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := &config.Config{
		JWTSecret: "test-secret-key-1234567890-test-key",
	}

	h := New(&MockQuerier{}, nil, &MockStorageService{}, nil, cfg)
	router := gin.New()
	h.RegisterRoutes(router)

	protectedRoutes := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/auth/me"},
		{http.MethodGet, "/api/v1/users/search"},
		{http.MethodPost, "/api/v1/chats/direct"},
		{http.MethodPost, "/api/v1/files/presign-upload"},
		{http.MethodPost, "/api/v1/files/confirm-upload"},
		{http.MethodGet, "/api/v1/files/00000000-0000-0000-0000-000000000001/download"},
		{http.MethodPost, "/api/v1/users/avatar"},
		{http.MethodPost, "/api/auth/profile/avatar"},
		{http.MethodGet, "/api/workspaces"},
		{http.MethodGet, "/api/groups"},
		{http.MethodGet, "/api/chats"},
	}

	for _, tc := range protectedRoutes {
		t.Run(tc.method+" "+tc.path+" returns 401 without token", func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Errorf("%s %s: expected status 401, got %d", tc.method, tc.path, rec.Code)
			}
		})
	}

	t.Run("Protected endpoint succeeds with valid Bearer JWT", func(t *testing.T) {
		testUserID := uuid.New()
		authHeader := generateAuthHeader(t, testUserID, "user@nexus.internal", cfg.JWTSecret)

		req := httptest.NewRequest(http.MethodGet, "/api/v1/users/search?q=test", nil)
		req.Header.Set("Authorization", authHeader)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		// Authentication should succeed (status != 401)
		if rec.Code == http.StatusUnauthorized {
			t.Errorf("expected authenticated request to not return 401, got %d", rec.Code)
		}
	})
}
