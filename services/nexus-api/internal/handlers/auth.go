package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"

	"nexus/nexus-api/internal/config"
	"nexus/nexus-api/internal/database"
	"nexus/nexus-api/internal/middleware"
)

type RegisterRequest struct {
	Email       string `json:"email" binding:"required,email"`
	Password    string `json:"password" binding:"required,min=6"`
	DisplayName string `json:"display_name"`
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type UpdateProfileRequest struct {
	Username    *string `json:"username"`
	Email       *string `json:"email"`
	DisplayName *string `json:"display_name"`
	FullName    *string `json:"full_name"`
	PhoneNumber *string `json:"phone_number"`
	AvatarURL   *string `json:"avatar_url"`
}

// sanitizeUser prepares a user domain model for JSON responses, stripping password hash.
func sanitizeUser(u database.User) gin.H {
	return gin.H{
		"id":           formatUUID(u.ID),
		"email":        u.Email,
		"display_name": u.DisplayName,
		"avatar_url":   u.AvatarUrl,
		"username":     stringPtrOrNil(u.Username),
		"phone_number": stringPtrOrNil(u.PhoneNumber),
		"system_role":  u.SystemRole,
		"created_at":   u.CreatedAt.Time,
		"last_seen":    u.LastSeen.Time,
	}
}

// Register handles POST /api/auth/register.
func (h *Handler) Register(c *gin.Context) {
	ctx := c.Request.Context()

	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 10)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}

	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		displayName = req.Email
	}

	// 1. Create User
	user, err := h.db.CreateUser(ctx, database.CreateUserParams{
		Email:        req.Email,
		PasswordHash: string(hash),
		DisplayName:  displayName,
	})
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "email already registered"})
		return
	}

	// 2. Create Tenant Organization
	tenant, err := h.db.CreateTenant(ctx, database.CreateTenantParams{
		Name: displayName + "'s Organization",
		Plan: "free",
	})
	if err == nil {
		// 3. Create Default Workspace
		code, _ := generateInviteCode()
		suffix := strings.ToLower(strings.ReplaceAll(code, "-", "")[:4])
		slugBase := strings.ToLower(strings.ReplaceAll(displayName, " ", "-"))
		wsSlug := fmt.Sprintf("%s-%s-workspace", slugBase, suffix)

		ws, wsErr := h.db.CreateWorkspace(ctx, database.CreateWorkspaceParams{
			TenantID: tenant.ID,
			Name:     displayName + "'s Workspace",
			Slug:     wsSlug,
		})
		if wsErr == nil {
			_ = h.db.AddWorkspaceMember(ctx, database.AddWorkspaceMemberParams{
				WorkspaceID: ws.ID,
				UserID:      user.ID,
				Role:        "owner",
			})

			// 4. Create default General group & channel
			var invitePg pgtype.Text
			_ = invitePg.Scan(code)
			grp, grpErr := h.db.CreateGroup(ctx, database.CreateGroupParams{
				TenantID:    tenant.ID,
				WorkspaceID: ws.ID,
				Name:        "General",
				OwnerID:     user.ID,
				AiEnabled:   true,
				InviteCode:  invitePg,
				Visibility:  "private",
				JoinPolicy:  "invite_only",
			})
			if grpErr == nil {
				_ = h.db.AddGroupMember(ctx, database.AddGroupMemberParams{
					GroupID: grp.ID,
					UserID:  user.ID,
					Role:    "owner",
				})

				_, _ = h.db.CreateChat(ctx, database.CreateChatParams{
					TenantID:    tenant.ID,
					WorkspaceID: ws.ID,
					GroupID:     grp.ID,
					Title:       "general",
				})
			}
		}
	}

	// 5. Generate JWT Token
	jwtSecret := h.cfg.JWTSecret
	if jwtSecret == "" {
		jwtSecret = config.DefaultJWTSecret
	}
	jwtExpiry := h.cfg.JWTExpiry
	if jwtExpiry <= 0 {
		jwtExpiry = 24 * time.Hour
	}

	token, err := middleware.GenerateJWT(formatUUID(user.ID), user.Email, jwtSecret, jwtExpiry)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate access token"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"user":  sanitizeUser(user),
		"token": token,
	})
}

// Login handles POST /api/auth/login.
func (h *Handler) Login(c *gin.Context) {
	ctx := c.Request.Context()

	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.db.GetUserByEmail(ctx, req.Email)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}

	_ = h.db.UpdateLastSeen(ctx, user.ID)

	jwtSecret := h.cfg.JWTSecret
	if jwtSecret == "" {
		jwtSecret = config.DefaultJWTSecret
	}
	jwtExpiry := h.cfg.JWTExpiry
	if jwtExpiry <= 0 {
		jwtExpiry = 24 * time.Hour
	}

	token, err := middleware.GenerateJWT(formatUUID(user.ID), user.Email, jwtSecret, jwtExpiry)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate access token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"user":  sanitizeUser(user),
		"token": token,
	})
}

// GetMe handles GET /api/auth/me.
func (h *Handler) GetMe(c *gin.Context) {
	ctx := c.Request.Context()

	uid, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	user, err := h.db.GetUserByID(ctx, uid)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	sanitized := sanitizeUser(user)

	// Combine nested "user" object and top-level fields for seamless client compatibility
	c.JSON(http.StatusOK, gin.H{
		"user":          sanitized,
		"id":            formatUUID(user.ID),
		"email":         user.Email,
		"display_name":  user.DisplayName,
		"full_name":     user.DisplayName,
		"avatar_url":    user.AvatarUrl,
		"profile_image": user.AvatarUrl,
		"username":      stringPtrOrNil(user.Username),
		"phone_number":  stringPtrOrNil(user.PhoneNumber),
	})
}

// UpdateProfile handles PUT /api/auth/profile.
func (h *Handler) UpdateProfile(c *gin.Context) {
	ctx := c.Request.Context()

	uid, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var usernamePg, phonePg, namePg, avatarPg pgtype.Text

	if req.Username != nil {
		_ = usernamePg.Scan(*req.Username)
	}
	if req.PhoneNumber != nil {
		_ = phonePg.Scan(*req.PhoneNumber)
	}
	if req.DisplayName != nil {
		_ = namePg.Scan(*req.DisplayName)
	} else if req.FullName != nil {
		_ = namePg.Scan(*req.FullName)
	}
	if req.AvatarURL != nil {
		_ = avatarPg.Scan(*req.AvatarURL)
	}

	updatedUser, err := h.db.UpdateUserDiscoveryProfile(ctx, database.UpdateUserDiscoveryProfileParams{
		ID:          uid,
		Username:    usernamePg,
		PhoneNumber: phonePg,
		DisplayName: namePg,
		AvatarUrl:   avatarPg,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update user profile"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Profile updated",
		"user":    sanitizeUser(updatedUser),
	})
}
