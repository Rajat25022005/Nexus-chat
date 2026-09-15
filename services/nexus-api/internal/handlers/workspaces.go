package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"nexus/nexus-api/internal/database"
)

type CreateWorkspaceRequest struct {
	TenantID string `json:"tenant_id" binding:"required"`
	Name     string `json:"name" binding:"required"`
	Slug     string `json:"slug" binding:"required"`
}

type AddWorkspaceMemberRequest struct {
	UserID string `json:"user_id" binding:"required"`
	Role   string `json:"role" binding:"required"`
}

// CreateWorkspace handles POST /api/workspaces.
func (h *Handler) CreateWorkspace(c *gin.Context) {
	ctx := c.Request.Context()

	uid, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req CreateWorkspaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	tenantID, err := parseUUID(req.TenantID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tenant_id format"})
		return
	}

	ws, err := h.db.CreateWorkspace(ctx, database.CreateWorkspaceParams{
		TenantID: tenantID,
		Name:     req.Name,
		Slug:     req.Slug,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create workspace"})
		return
	}

	_ = h.db.AddWorkspaceMember(ctx, database.AddWorkspaceMemberParams{
		WorkspaceID: ws.ID,
		UserID:      uid,
		Role:        "owner",
	})

	c.JSON(http.StatusCreated, gin.H{"workspace": ws})
}

// ListWorkspaces handles GET /api/workspaces.
func (h *Handler) ListWorkspaces(c *gin.Context) {
	ctx := c.Request.Context()

	uid, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	tenantIDStr := c.Query("tenant_id")
	if tenantIDStr != "" {
		tid, err := parseUUID(tenantIDStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tenant_id format"})
			return
		}

		workspaces, err := h.db.ListWorkspacesByTenant(ctx, database.ListWorkspacesByTenantParams{
			TenantID: tid,
			UserID:   uid,
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list workspaces"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"workspaces": workspaces})
		return
	}

	workspaces, err := h.db.ListWorkspacesByUser(ctx, uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list workspaces"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"workspaces": workspaces})
}

// GetWorkspace handles GET /api/workspaces/:id.
func (h *Handler) GetWorkspace(c *gin.Context) {
	ctx := c.Request.Context()

	uid, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	wsID, ok := parseUUIDParam(c, "id")
	if !ok {
		return
	}

	// Caller must be a member of the workspace
	_, err = h.db.GetWorkspaceMember(ctx, database.GetWorkspaceMemberParams{
		WorkspaceID: wsID,
		UserID:      uid,
	})
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied to this workspace"})
		return
	}

	ws, err := h.db.GetWorkspaceByID(ctx, wsID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "workspace not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"workspace": ws})
}

// ListWorkspaceMembers handles GET /api/workspaces/:id/members.
func (h *Handler) ListWorkspaceMembers(c *gin.Context) {
	ctx := c.Request.Context()

	uid, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	wsID, ok := parseUUIDParam(c, "id")
	if !ok {
		return
	}

	// Caller must be a member of the workspace
	_, err = h.db.GetWorkspaceMember(ctx, database.GetWorkspaceMemberParams{
		WorkspaceID: wsID,
		UserID:      uid,
	})
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied to workspace members"})
		return
	}

	members, err := h.db.ListWorkspaceMembers(ctx, wsID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list workspace members"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"members": members})
}

// AddWorkspaceMember handles POST /api/workspaces/:id/members.
func (h *Handler) AddWorkspaceMember(c *gin.Context) {
	ctx := c.Request.Context()

	callerUID, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	wsID, ok := parseUUIDParam(c, "id")
	if !ok {
		return
	}

	// Only owners or admins can add members
	callerMember, err := h.db.GetWorkspaceMember(ctx, database.GetWorkspaceMemberParams{
		WorkspaceID: wsID,
		UserID:      callerUID,
	})
	if err != nil || (callerMember.Role != "owner" && callerMember.Role != "admin") {
		c.JSON(http.StatusForbidden, gin.H{"error": "only workspace owners or admins can add members"})
		return
	}

	var req AddWorkspaceMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	targetUID, err := parseUUID(req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user_id format"})
		return
	}

	if err := h.db.AddWorkspaceMember(ctx, database.AddWorkspaceMemberParams{
		WorkspaceID: wsID,
		UserID:      targetUID,
		Role:        req.Role,
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to add workspace member"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true})
}
