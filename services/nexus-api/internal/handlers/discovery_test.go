package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"nexus/nexus-api/internal/config"
	"nexus/nexus-api/internal/database"
	"nexus/nexus-api/internal/middleware"
)

func setupTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	return gin.New()
}

func generateAuthHeader(t *testing.T, userID uuid.UUID, email, secret string) string {
	token, err := middleware.GenerateJWT(userID.String(), email, secret, time.Hour)
	if err != nil {
		t.Fatalf("failed to generate test JWT: %v", err)
	}
	return "Bearer " + token
}

func TestMaskEmail(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"sarah.connor@nexus.internal", "s••••••••••r@nexus.internal"},
		{"john@domain.com", "j••n@domain.com"},
		{"ab@domain.com", "a•••@domain.com"},
		{"a@domain.com", "a•••@domain.com"},
		{"invalid-email", "•••••"},
		{"", "•••••"},
	}

	for _, tc := range tests {
		got := MaskEmail(tc.input)
		if got != tc.expected {
			t.Errorf("MaskEmail(%q) = %q; want %q", tc.input, got, tc.expected)
		}
	}
}

func TestMaskPhoneNumber(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"+14155552671", "+1 ••• ••• 2671"},
		{"+447911123456", "+4 ••• ••• 3456"},
		{"123", "••• ••• ••••"},
		{"", "••• ••• ••••"},
	}

	for _, tc := range tests {
		got := MaskPhoneNumber(tc.input)
		if got != tc.expected {
			t.Errorf("MaskPhoneNumber(%q) = %q; want %q", tc.input, got, tc.expected)
		}
	}
}

func TestDiscovery_ExactEmailSearch(t *testing.T) {
	callerID := uuid.New()
	targetID := uuid.New()
	targetEmail := "sarah.connor@nexus.internal"

	mockQuerier := &MockQuerier{
		SearchUserByExactQueryFn: func(ctx context.Context, arg database.SearchUserByExactQueryParams) (database.User, error) {
			if arg.Query == targetEmail {
				return database.User{
					ID:          uuidToPg(targetID),
					Email:       targetEmail,
					DisplayName: "Sarah Connor",
					Username:    textPg("sconnor"),
					PhoneNumber: textPg("+14155554421"),
					CreatedAt:   pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
				}, nil
			}
			return database.User{}, pgx.ErrNoRows
		},
	}

	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(mockQuerier, nil, nil, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	req, _ := http.NewRequest("GET", "/api/v1/users/search?q="+targetEmail, nil)
	req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.internal", cfg.JWTSecret))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp UserSearchResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Total != 1 || len(resp.Users) != 1 {
		t.Fatalf("expected 1 user, got %d", resp.Total)
	}

	user := resp.Users[0]
	if user.Email != targetEmail {
		t.Errorf("expected cleartext email %q, got %q", targetEmail, user.Email)
	}
	if user.EmailMasked != "s••••••••••r@nexus.internal" {
		t.Errorf("expected masked email, got %q", user.EmailMasked)
	}
	if user.PhoneNumberMasked != "+1 ••• ••• 4421" {
		t.Errorf("expected masked phone number, got %q", user.PhoneNumberMasked)
	}
}

func TestDiscovery_ExactPhoneSearch(t *testing.T) {
	callerID := uuid.New()
	targetID := uuid.New()
	targetPhone := "+14155554421"

	mockQuerier := &MockQuerier{
		SearchUserByExactQueryFn: func(ctx context.Context, arg database.SearchUserByExactQueryParams) (database.User, error) {
			if arg.Query == targetPhone {
				return database.User{
					ID:          uuidToPg(targetID),
					Email:       "sarah.connor@nexus.internal",
					DisplayName: "Sarah Connor",
					Username:    textPg("sconnor"),
					PhoneNumber: textPg(targetPhone),
					CreatedAt:   pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
				}, nil
			}
			return database.User{}, pgx.ErrNoRows
		},
	}

	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(mockQuerier, nil, nil, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	req, _ := http.NewRequest("GET", "/api/v1/users/search?q="+targetPhone, nil)
	req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.internal", cfg.JWTSecret))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp UserSearchResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Total != 1 || len(resp.Users) != 1 {
		t.Fatalf("expected 1 user, got %d", resp.Total)
	}

	user := resp.Users[0]
	// Critical: Cleartext email MUST be omitted on phone search
	if user.Email != "" {
		t.Errorf("cleartext email must be empty on phone search, got %q", user.Email)
	}
	if user.EmailMasked != "s••••••••••r@nexus.internal" {
		t.Errorf("expected masked email, got %q", user.EmailMasked)
	}
	if user.PhoneNumberMasked != "+1 ••• ••• 4421" {
		t.Errorf("expected masked phone number, got %q", user.PhoneNumberMasked)
	}
}

func TestDiscovery_UsernamePrefixSearch(t *testing.T) {
	callerID := uuid.New()
	targetID := uuid.New()

	mockQuerier := &MockQuerier{
		SearchUsersByUsernamePrefixFn: func(ctx context.Context, arg database.SearchUsersByUsernamePrefixParams) ([]database.User, error) {
			if arg.Prefix == "scon" {
				return []database.User{
					{
						ID:          uuidToPg(targetID),
						Email:       "sarah.connor@nexus.internal",
						DisplayName: "Sarah Connor",
						Username:    textPg("sconnor"),
						PhoneNumber: textPg("+14155554421"),
						CreatedAt:   pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
					},
				}, nil
			}
			return nil, nil
		},
	}

	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(mockQuerier, nil, nil, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	req, _ := http.NewRequest("GET", "/api/v1/users/search?q=scon", nil)
	req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.internal", cfg.JWTSecret))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp UserSearchResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Total != 1 || len(resp.Users) != 1 {
		t.Fatalf("expected 1 user, got %d", resp.Total)
	}

	user := resp.Users[0]
	// Critical: Cleartext email MUST be omitted on prefix search
	if user.Email != "" {
		t.Errorf("cleartext email must be empty on prefix search, got %q", user.Email)
	}
	if user.EmailMasked != "s••••••••••r@nexus.internal" {
		t.Errorf("expected masked email, got %q", user.EmailMasked)
	}
	if user.PhoneNumberMasked != "+1 ••• ••• 4421" {
		t.Errorf("expected masked phone number, got %q", user.PhoneNumberMasked)
	}
}

func TestDiscovery_InvalidQueries(t *testing.T) {
	callerID := uuid.New()
	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(&MockQuerier{}, nil, nil, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	// 1. Query too short (< 3 chars)
	req1, _ := http.NewRequest("GET", "/api/v1/users/search?q=sc", nil)
	req1.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.internal", cfg.JWTSecret))
	w1 := httptest.NewRecorder()
	router.ServeHTTP(w1, req1)
	if w1.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for short query, got %d", w1.Code)
	}

	// 2. Query with invalid regex characters (e.g. SQL wildcards % or spaces)
	req2, _ := http.NewRequest("GET", "/api/v1/users/search?q=scon%nor", nil)
	req2.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.internal", cfg.JWTSecret))
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, req2)
	if w2.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid regex query, got %d", w2.Code)
	}
}

func TestDiscovery_BlockedUserExclusion(t *testing.T) {
	callerID := uuid.New()

	// Simulating that the query filters out blocked user (returns ErrNoRows)
	mockQuerier := &MockQuerier{
		SearchUserByExactQueryFn: func(ctx context.Context, arg database.SearchUserByExactQueryParams) (database.User, error) {
			return database.User{}, pgx.ErrNoRows
		},
	}

	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(mockQuerier, nil, nil, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	req, _ := http.NewRequest("GET", "/api/v1/users/search?q=blocked@nexus.internal", nil)
	req.Header.Set("Authorization", generateAuthHeader(t, callerID, "caller@nexus.internal", cfg.JWTSecret))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var resp UserSearchResponse
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Total != 0 || len(resp.Users) != 0 {
		t.Errorf("expected 0 results for blocked user, got %d", resp.Total)
	}
}
