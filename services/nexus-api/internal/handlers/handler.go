package handlers

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"nexus/nexus-api/internal/config"
	"nexus/nexus-api/internal/database"
	"nexus/nexus-api/internal/middleware"
	"nexus/nexus-api/internal/services"
	"nexus/nexus-api/internal/storage"
)

// Handler serves as the centralized HTTP handler aggregating all API endpoints.
type Handler struct {
	db      database.Querier
	pool    *pgxpool.Pool
	storage storage.StorageService
	redis   services.Broadcaster
	cfg     *config.Config
}

// New constructs a new Handler instance.
func New(
	db database.Querier,
	pool *pgxpool.Pool,
	storage storage.StorageService,
	redis services.Broadcaster,
	cfg *config.Config,
) *Handler {
	return &Handler{
		db:      db,
		pool:    pool,
		storage: storage,
		redis:   redis,
		cfg:     cfg,
	}
}

// RegisterRoutes registers all API routes onto the given Gin engine.
func (h *Handler) RegisterRoutes(r *gin.Engine) {
	// 1. Favicon & Root Probes
	r.GET("/favicon.ico", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "healthy",
			"service": "nexus-api",
			"time":    time.Now().UTC(),
		})
	})

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "healthy",
			"service": "nexus-api",
			"time":    time.Now().UTC(),
		})
	})

	r.GET("/live", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "alive"})
	})

	r.GET("/ready", func(c *gin.Context) {
		if h.pool != nil {
			ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
			defer cancel()
			if err := h.pool.Ping(ctx); err != nil {
				c.JSON(http.StatusServiceUnavailable, gin.H{
					"status": "unready",
					"error":  "database ping failed: " + err.Error(),
				})
				return
			}
		}
		c.JSON(http.StatusOK, gin.H{"status": "ready", "database": "connected"})
	})

	r.GET("/metrics/runtime", h.GetRuntimeMetrics)

	// 2. Base API Route Groups
	api := r.Group("/api")

	// Public Auth Endpoints
	api.POST("/auth/register", h.Register)
	api.POST("/auth/login", h.Login)

	// Protected Endpoints Group (Requires valid JWT)
	jwtSecret := h.cfg.JWTSecret
	if jwtSecret == "" {
		jwtSecret = config.DefaultJWTSecret
	}
	protected := api.Group("/")
	protected.Use(middleware.JWTAuthMiddleware(jwtSecret))

	// Protected User Profile & Backward Compatibility Adapter
	protected.GET("/auth/me", h.GetMe)
	protected.PUT("/auth/profile", h.UpdateProfile)
	protected.POST("/auth/profile/avatar", h.AvatarUploadAdapter)

	// Workspaces
	protected.POST("/workspaces", h.CreateWorkspace)
	protected.GET("/workspaces", h.ListWorkspaces)
	protected.GET("/workspaces/:id", h.GetWorkspace)
	protected.GET("/workspaces/:id/members", h.ListWorkspaceMembers)
	protected.POST("/workspaces/:id/members", h.AddWorkspaceMember)

	// Groups
	protected.POST("/groups", h.CreateGroup)
	protected.GET("/groups", h.ListGroups)
	protected.POST("/groups/join", h.JoinGroup)
	protected.DELETE("/groups/:id", h.DeleteGroup)

	// Chats & Messages
	protected.POST("/chats", h.CreateChat)
	protected.GET("/chats", h.ListChats)
	protected.GET("/chats/:id/messages", h.ListMessages)
	protected.GET("/messages/:id/thread", h.GetMessageThread)

	// 3. API v1 Endpoints (User Discovery, Direct Chats, S3 Pre-signed Lifecycle)
	v1 := r.Group("/api/v1")
	v1.Use(middleware.JWTAuthMiddleware(jwtSecret))

	// User Discovery with Sliding Window Rate Limiting (30 req/min)
	var searchRateLimiter gin.HandlerFunc
	if h.redis != nil && h.redis.Client() != nil {
		searchRateLimiter = middleware.SlidingWindowRateLimiterWithPrefix(
			h.redis.Client(),
			"ratelimit:search",
			30,
			time.Minute,
		)
	} else {
		searchRateLimiter = func(c *gin.Context) { c.Next() }
	}
	v1.GET("/users/search", searchRateLimiter, h.SearchUsers)

	// Direct (1:1) Messaging Initiation with 23505 Concurrency Recovery
	v1.POST("/chats/direct", h.CreateDirectChat)

	// File Storage Lifecycle (Pre-signed Upload, S3 Confirm, Download Authorization)
	v1.POST("/files/presign-upload", h.PresignUpload)
	v1.POST("/files/confirm-upload", h.ConfirmUpload)
	v1.GET("/files/:id/download", h.DownloadFile)
	v1.POST("/users/avatar", h.AvatarUploadAdapter)
}

// ────────────────────────────────────────────────────────────────
// Helper Functions
// ────────────────────────────────────────────────────────────────

// getUserIDFromContext extracts the authenticated user's UUID from Gin context.
func getUserIDFromContext(c *gin.Context) (pgtype.UUID, error) {
	uid, err := middleware.GetUserID(c)
	if err == nil {
		var pgUID pgtype.UUID
		pgUID.Bytes = uid
		pgUID.Valid = true
		return pgUID, nil
	}

	val, exists := c.Get(middleware.ContextUserIDKey)
	if !exists {
		return pgtype.UUID{}, errors.New("user_id not found in context")
	}

	str, ok := val.(string)
	if !ok || str == "" {
		return pgtype.UUID{}, errors.New("invalid user_id in context")
	}

	return parseUUID(str)
}

// parseUUID validates and converts a string into pgtype.UUID.
func parseUUID(s string) (pgtype.UUID, error) {
	u, err := uuid.Parse(strings.TrimSpace(s))
	if err != nil {
		return pgtype.UUID{}, fmt.Errorf("invalid UUID format: %w", err)
	}
	var pgUID pgtype.UUID
	pgUID.Bytes = u
	pgUID.Valid = true
	return pgUID, nil
}

// parseUUIDParam extracts a URL parameter and validates it as a pgtype.UUID.
func parseUUIDParam(c *gin.Context, paramName string) (pgtype.UUID, bool) {
	raw := c.Param(paramName)
	uid, err := parseUUID(raw)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid UUID for parameter '%s'", paramName)})
		return pgtype.UUID{}, false
	}
	return uid, true
}

// formatUUID converts a pgtype.UUID to a standard canonical string.
func formatUUID(id pgtype.UUID) string {
	if !id.Valid {
		return ""
	}
	u, err := uuid.FromBytes(id.Bytes[:])
	if err != nil {
		return ""
	}
	return u.String()
}

// stringPtrOrNil converts a pgtype.Text to *string.
func stringPtrOrNil(t pgtype.Text) *string {
	if t.Valid && t.String != "" {
		s := t.String
		return &s
	}
	return nil
}

const crockfordAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// generateInviteCode produces a human-readable Crockford base-32 invite code (e.g. NX7K-Q2R9).
func generateInviteCode() (string, error) {
	code := make([]byte, 8)
	for i := range code {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(crockfordAlphabet))))
		if err != nil {
			return "", err
		}
		code[i] = crockfordAlphabet[n.Int64()]
	}
	return string(code[:4]) + "-" + string(code[4:]), nil
}

// mustJSON serializes an object into JSON bytes, returning empty JSON object on error.
func mustJSON(v interface{}) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return b
}
