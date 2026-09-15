package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"

	"nexus/nexus-api/internal/database"
)

type CreateGroupRequest struct {
	TenantID    string `json:"tenant_id"`
	WorkspaceID string `json:"workspace_id"`
	Name        string `json:"name" binding:"required"`
	AIEnabled   bool   `json:"ai_enabled"`
}

type JoinGroupRequest struct {
	Code string `json:"code" binding:"required"`
}

// serializeGroup builds a consistent, clean JSON structure matching client expectations.
func serializeGroup(g database.Group, chats []database.Chat, members []database.ListGroupMembersRow) gin.H {
	memberEmails := make([]string, len(members))
	for i, m := range members {
		memberEmails[i] = m.Email
	}

	inviteCode := ""
	if g.InviteCode.Valid {
		inviteCode = g.InviteCode.String
	}

	formattedChats := make([]gin.H, 0, len(chats))
	for _, ch := range chats {
		formattedChats = append(formattedChats, gin.H{
			"id":           formatUUID(ch.ID),
			"tenant_id":    formatUUID(ch.TenantID),
			"workspace_id": formatUUID(ch.WorkspaceID),
			"group_id":     formatUUID(ch.GroupID),
			"title":        ch.Title,
			"created_at":   ch.CreatedAt.Time,
		})
	}

	return gin.H{
		"id":           formatUUID(g.ID),
		"tenant_id":    formatUUID(g.TenantID),
		"workspace_id": formatUUID(g.WorkspaceID),
		"name":         g.Name,
		"owner_id":     formatUUID(g.OwnerID),
		"ai_enabled":   g.AiEnabled,
		"invite_code":  inviteCode,
		"visibility":   g.Visibility,
		"join_policy":  g.JoinPolicy,
		"created_at":   g.CreatedAt.Time,
		"chats":        formattedChats,
		"members":      memberEmails,
	}
}

// CreateGroup handles POST /api/groups.
func (h *Handler) CreateGroup(c *gin.Context) {
	ctx := c.Request.Context()

	uid, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req CreateGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var tenantID, wsID pgtype.UUID
	if req.TenantID != "" && req.WorkspaceID != "" {
		var tErr, wErr error
		tenantID, tErr = parseUUID(req.TenantID)
		wsID, wErr = parseUUID(req.WorkspaceID)
		if tErr != nil || wErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tenant_id or workspace_id format"})
			return
		}
	} else {
		workspaces, err := h.db.ListWorkspacesByUser(ctx, uid)
		if err != nil || len(workspaces) == 0 {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "no workspace available to create group"})
			return
		}
		tenantID = workspaces[0].TenantID
		wsID = workspaces[0].ID
	}

	inviteCode, err := generateInviteCode()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate invite code"})
		return
	}

	var inviteCodePg pgtype.Text
	_ = inviteCodePg.Scan(inviteCode)

	group, err := h.db.CreateGroup(ctx, database.CreateGroupParams{
		TenantID:    tenantID,
		WorkspaceID: wsID,
		Name:        req.Name,
		OwnerID:     uid,
		AiEnabled:   req.AIEnabled,
		InviteCode:  inviteCodePg,
		Visibility:  "private",
		JoinPolicy:  "invite_only",
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create group"})
		return
	}

	_ = h.db.AddGroupMember(ctx, database.AddGroupMemberParams{
		GroupID: group.ID,
		UserID:  uid,
		Role:    "owner",
	})

	chat, err := h.db.CreateChat(ctx, database.CreateChatParams{
		TenantID:    tenantID,
		WorkspaceID: wsID,
		GroupID:     group.ID,
		Title:       "General",
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create default chat"})
		return
	}

	_ = h.db.InsertAuditLog(ctx, database.InsertAuditLogParams{
		GroupID: group.ID,
		ActorID: uid,
		Action:  "group.created",
		Metadata: mustJSON(map[string]string{
			"name":        req.Name,
			"invite_code": inviteCode,
		}),
	})

	members, _ := h.db.ListGroupMembers(ctx, group.ID)

	c.JSON(http.StatusCreated, gin.H{
		"group": serializeGroup(group, []database.Chat{chat}, members),
	})
}

// ListGroups handles GET /api/groups.
func (h *Handler) ListGroups(c *gin.Context) {
	ctx := c.Request.Context()

	uid, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	groups, err := h.db.ListGroupsByUser(ctx, uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list groups"})
		return
	}

	// Auto-provision default group if empty
	if len(groups) == 0 {
		workspaces, err := h.db.ListWorkspacesByUser(ctx, uid)
		if err == nil && len(workspaces) > 0 {
			ws := workspaces[0]
			code, _ := generateInviteCode()
			var inviteCodePg pgtype.Text
			_ = inviteCodePg.Scan(code)

			newGrp, err := h.db.CreateGroup(ctx, database.CreateGroupParams{
				TenantID:    ws.TenantID,
				WorkspaceID: ws.ID,
				Name:        "General",
				OwnerID:     uid,
				AiEnabled:   true,
				InviteCode:  inviteCodePg,
				Visibility:  "private",
				JoinPolicy:  "invite_only",
			})
			if err == nil {
				_ = h.db.AddGroupMember(ctx, database.AddGroupMemberParams{
					GroupID: newGrp.ID,
					UserID:  uid,
					Role:    "owner",
				})
				_, _ = h.db.CreateChat(ctx, database.CreateChatParams{
					TenantID:    ws.TenantID,
					WorkspaceID: ws.ID,
					GroupID:     newGrp.ID,
					Title:       "general",
				})
				groups = []database.Group{newGrp}
			}
		}
	}

	var result []gin.H
	for _, g := range groups {
		chats, err := h.db.ListChatsByGroup(ctx, g.ID)
		if err != nil {
			chats = []database.Chat{}
		}
		members, err := h.db.ListGroupMembers(ctx, g.ID)
		if err != nil {
			members = []database.ListGroupMembersRow{}
		}
		result = append(result, serializeGroup(g, chats, members))
	}

	c.JSON(http.StatusOK, gin.H{"groups": result})
}

// JoinGroup handles POST /api/groups/join.
func (h *Handler) JoinGroup(c *gin.Context) {
	ctx := c.Request.Context()

	uid, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req JoinGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	code := strings.ToUpper(strings.TrimSpace(req.Code))
	var inviteCodePg pgtype.Text
	_ = inviteCodePg.Scan(code)

	group, err := h.db.GetGroupByInviteCode(ctx, inviteCodePg)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "invalid invite code"})
		return
	}

	// Check if already a member
	_, err = h.db.GetGroupMember(ctx, database.GetGroupMemberParams{
		GroupID: group.ID,
		UserID:  uid,
	})
	if err == nil {
		chats, _ := h.db.ListChatsByGroup(ctx, group.ID)
		members, _ := h.db.ListGroupMembers(ctx, group.ID)
		c.JSON(http.StatusOK, gin.H{"group": serializeGroup(group, chats, members)})
		return
	}

	// Add membership
	_ = h.db.AddGroupMember(ctx, database.AddGroupMemberParams{
		GroupID: group.ID,
		UserID:  uid,
		Role:    "member",
	})
	_ = h.db.AddWorkspaceMember(ctx, database.AddWorkspaceMemberParams{
		WorkspaceID: group.WorkspaceID,
		UserID:      uid,
		Role:        "member",
	})

	_ = h.db.InsertAuditLog(ctx, database.InsertAuditLogParams{
		GroupID: group.ID,
		ActorID: uid,
		Action:  "member.joined",
		Metadata: mustJSON(map[string]string{
			"method": "invite_code",
			"code":   code,
		}),
	})

	chats, _ := h.db.ListChatsByGroup(ctx, group.ID)
	members, _ := h.db.ListGroupMembers(ctx, group.ID)
	c.JSON(http.StatusOK, gin.H{"group": serializeGroup(group, chats, members)})
}

// DeleteGroup handles DELETE /api/groups/:id.
func (h *Handler) DeleteGroup(c *gin.Context) {
	ctx := c.Request.Context()

	uid, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	groupID, ok := parseUUIDParam(c, "id")
	if !ok {
		return
	}

	group, err := h.db.GetGroupByID(ctx, groupID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "group not found"})
		return
	}

	if group.OwnerID != uid {
		c.JSON(http.StatusForbidden, gin.H{"error": "only the group owner can delete this group"})
		return
	}

	var reason pgtype.Text
	_ = reason.Scan("deleted by owner")

	err = h.db.SoftDeleteGroup(ctx, database.SoftDeleteGroupParams{
		ID:             groupID,
		DeletionReason: reason,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete group"})
		return
	}

	_ = h.db.InsertAuditLog(ctx, database.InsertAuditLogParams{
		GroupID:  groupID,
		ActorID:  uid,
		Action:   "group.deleted",
		Metadata: mustJSON(map[string]string{"reason": "deleted by owner"}),
	})

	c.JSON(http.StatusOK, gin.H{"success": true})
}
