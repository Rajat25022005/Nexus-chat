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
	"golang.org/x/crypto/bcrypt"

	"nexus/nexus-api/internal/config"
	"nexus/nexus-api/internal/database"
)

func TestAuth_RegisterAndLogin(t *testing.T) {
	testEmail := "testuser@nexus.internal"
	testPassword := "password123"
	testDisplayName := "Test User"
	userID := uuid.New()

	var storedHash string
	hash, _ := bcrypt.GenerateFromPassword([]byte(testPassword), 10)
	storedHash = string(hash)

	mockQuerier := &MockQuerier{
		CreateUserFn: func(ctx context.Context, arg database.CreateUserParams) (database.User, error) {
			return database.User{
				ID:          uuidToPg(userID),
				Email:       arg.Email,
				DisplayName: arg.DisplayName,
				CreatedAt:   pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
			}, nil
		},
		CreateTenantFn: func(ctx context.Context, arg database.CreateTenantParams) (database.Tenant, error) {
			return database.Tenant{ID: uuidToPg(uuid.New()), Name: arg.Name}, nil
		},
		CreateWorkspaceFn: func(ctx context.Context, arg database.CreateWorkspaceParams) (database.Workspace, error) {
			return database.Workspace{ID: uuidToPg(uuid.New()), Name: arg.Name}, nil
		},
		CreateGroupFn: func(ctx context.Context, arg database.CreateGroupParams) (database.Group, error) {
			return database.Group{ID: uuidToPg(uuid.New()), Name: arg.Name}, nil
		},
		CreateChatFn: func(ctx context.Context, arg database.CreateChatParams) (database.Chat, error) {
			return database.Chat{ID: uuidToPg(uuid.New()), Title: arg.Title}, nil
		},
		GetUserByEmailFn: func(ctx context.Context, email string) (database.User, error) {
			if email == testEmail {
				return database.User{
					ID:           uuidToPg(userID),
					Email:        testEmail,
					PasswordHash: storedHash,
					DisplayName:  testDisplayName,
					CreatedAt:    pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
				}, nil
			}
			return database.User{}, nil
		},
	}

	cfg := &config.Config{
		JWTSecret: "test-secret-key-12345",
		JWTExpiry: 24 * time.Hour,
	}
	h := New(mockQuerier, nil, nil, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	// 1. Test Registration
	regBody := `{"email": "` + testEmail + `", "password": "` + testPassword + `", "display_name": "` + testDisplayName + `"}`
	reqReg, _ := http.NewRequest("POST", "/api/auth/register", strings.NewReader(regBody))
	reqReg.Header.Set("Content-Type", "application/json")
	wReg := httptest.NewRecorder()
	router.ServeHTTP(wReg, reqReg)

	if wReg.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for register, got %d: %s", wReg.Code, wReg.Body.String())
	}

	var regResp map[string]interface{}
	if err := json.Unmarshal(wReg.Body.Bytes(), &regResp); err != nil {
		t.Fatalf("failed to decode register response: %v", err)
	}
	if regResp["token"] == nil || regResp["token"] == "" {
		t.Errorf("expected JWT token in register response")
	}

	// 2. Test Login Success
	loginBody := `{"email": "` + testEmail + `", "password": "` + testPassword + `"}`
	reqLogin, _ := http.NewRequest("POST", "/api/auth/login", strings.NewReader(loginBody))
	reqLogin.Header.Set("Content-Type", "application/json")
	wLogin := httptest.NewRecorder()
	router.ServeHTTP(wLogin, reqLogin)

	if wLogin.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for login, got %d: %s", wLogin.Code, wLogin.Body.String())
	}

	// 3. Test Login Failure (Wrong password)
	badLoginBody := `{"email": "` + testEmail + `", "password": "wrongpassword"}`
	reqBadLogin, _ := http.NewRequest("POST", "/api/auth/login", strings.NewReader(badLoginBody))
	reqBadLogin.Header.Set("Content-Type", "application/json")
	wBadLogin := httptest.NewRecorder()
	router.ServeHTTP(wBadLogin, reqBadLogin)

	if wBadLogin.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for wrong password, got %d", wBadLogin.Code)
	}
}

func TestAuth_GetMe(t *testing.T) {
	userID := uuid.New()
	mockQuerier := &MockQuerier{
		GetUserByIDFn: func(ctx context.Context, id pgtype.UUID) (database.User, error) {
			return database.User{
				ID:          uuidToPg(userID),
				Email:       "me@nexus.internal",
				DisplayName: "Current User",
				AvatarUrl:   "http://localhost:9000/nexus-avatars/avatar.png",
				Username:    textPg("currentuser"),
				CreatedAt:   pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
			}, nil
		},
	}

	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(mockQuerier, nil, nil, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	req, _ := http.NewRequest("GET", "/api/auth/me", nil)
	req.Header.Set("Authorization", generateAuthHeader(t, userID, "me@nexus.internal", cfg.JWTSecret))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for /api/auth/me, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp["email"] != "me@nexus.internal" {
		t.Errorf("expected email me@nexus.internal, got %v", resp["email"])
	}
	if resp["user"] == nil {
		t.Errorf("expected user sub-object for client compatibility")
	}
}

func TestAuth_UpdateProfile(t *testing.T) {
	userID := uuid.New()
	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}

	t.Run("success: updates profile fields", func(t *testing.T) {
		mockQuerier := &MockQuerier{
			UpdateUserDiscoveryProfileFn: func(ctx context.Context, arg database.UpdateUserDiscoveryProfileParams) (database.User, error) {
				return database.User{
					ID:          arg.ID,
					Email:       "me@nexus.internal",
					DisplayName: arg.DisplayName.String,
					Username:    arg.Username,
					PhoneNumber: arg.PhoneNumber,
					AvatarUrl:   arg.AvatarUrl.String,
					CreatedAt:   pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
				}, nil
			},
		}

		h := New(mockQuerier, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		payload := `{"username":"newuser","display_name":"New Name","phone_number":"+1234567890","avatar_url":"http://avatar.png"}`
		req, _ := http.NewRequest("PUT", "/api/auth/profile", strings.NewReader(payload))
		req.Header.Set("Authorization", generateAuthHeader(t, userID, "me@nexus.internal", cfg.JWTSecret))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for update profile, got %d: %s", w.Code, w.Body.String())
		}

		var resp map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		if resp["success"] != true {
			t.Errorf("expected success true, got %v", resp["success"])
		}
	})

	t.Run("success: fallback to full_name when display_name is omitted", func(t *testing.T) {
		var capturedName string
		mockQuerier := &MockQuerier{
			UpdateUserDiscoveryProfileFn: func(ctx context.Context, arg database.UpdateUserDiscoveryProfileParams) (database.User, error) {
				capturedName = arg.DisplayName.String
				return database.User{
					ID:          arg.ID,
					Email:       "me@nexus.internal",
					DisplayName: arg.DisplayName.String,
				}, nil
			},
		}

		h := New(mockQuerier, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		payload := `{"full_name":"Full Name Fallback"}`
		req, _ := http.NewRequest("PUT", "/api/auth/profile", strings.NewReader(payload))
		req.Header.Set("Authorization", generateAuthHeader(t, userID, "me@nexus.internal", cfg.JWTSecret))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d", w.Code)
		}
		if capturedName != "Full Name Fallback" {
			t.Errorf("expected captured name 'Full Name Fallback', got %q", capturedName)
		}
	})

	t.Run("database error on update", func(t *testing.T) {
		mockQuerier := &MockQuerier{
			UpdateUserDiscoveryProfileFn: func(ctx context.Context, arg database.UpdateUserDiscoveryProfileParams) (database.User, error) {
				return database.User{}, errors.New("unique violation on username")
			},
		}

		h := New(mockQuerier, nil, nil, nil, cfg)
		router := setupTestRouter()
		h.RegisterRoutes(router)

		payload := `{"username":"taken"}`
		req, _ := http.NewRequest("PUT", "/api/auth/profile", strings.NewReader(payload))
		req.Header.Set("Authorization", generateAuthHeader(t, userID, "me@nexus.internal", cfg.JWTSecret))
		req.Header.Set("Content-Type", "application/json")

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500 Internal Server Error, got %d", w.Code)
		}
	})
}
