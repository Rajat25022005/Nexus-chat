package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"nexus/nexus-api/internal/database"
)

type CreateChatRequest struct {
	GroupID string `json:"group_id" binding:"required"`
	Title   string `json:"title" binding:"required"`
}

// CreateChat handles POST /api/chats.
func (h *Handler) CreateChat(c *gin.Context) {
	ctx := c.Request.Context()

	uid, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req CreateChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	groupID, err := parseUUID(req.GroupID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid group_id format"})
		return
	}

	group, err := h.db.GetGroupByID(ctx, groupID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "group not found"})
		return
	}

	// Verify membership
	_, err = h.db.GetGroupMember(ctx, database.GetGroupMemberParams{
		GroupID: group.ID,
		UserID:  uid,
	})
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "must be a group member to create a chat"})
		return
	}

	chat, err := h.db.CreateChat(ctx, database.CreateChatParams{
		TenantID:    group.TenantID,
		WorkspaceID: group.WorkspaceID,
		GroupID:     group.ID,
		Title:       req.Title,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create chat"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"chat": gin.H{
			"id":           formatUUID(chat.ID),
			"tenant_id":    formatUUID(chat.TenantID),
			"workspace_id": formatUUID(chat.WorkspaceID),
			"group_id":     formatUUID(chat.GroupID),
			"title":        chat.Title,
			"created_at":   chat.CreatedAt.Time,
		},
	})
}

// ListChats handles GET /api/chats.
func (h *Handler) ListChats(c *gin.Context) {
	ctx := c.Request.Context()

	uid, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	groupIDStr := c.Query("group_id")
	if groupIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "group_id query parameter required"})
		return
	}

	gid, err := parseUUID(groupIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid group_id format"})
		return
	}

	// Check group membership
	_, err = h.db.GetGroupMember(ctx, database.GetGroupMemberParams{
		GroupID: gid,
		UserID:  uid,
	})
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied to this group's chats"})
		return
	}

	chats, err := h.db.ListChatsByGroup(ctx, gid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list chats"})
		return
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

	c.JSON(http.StatusOK, gin.H{"chats": formattedChats})
}

// ListMessages handles GET /api/chats/:id/messages.
func (h *Handler) ListMessages(c *gin.Context) {
	ctx := c.Request.Context()

	_, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	chatID, ok := parseUUIDParam(c, "id")
	if !ok {
		return
	}

	limit := 50
	if l := c.Query("limit"); l != "" {
		if val, err := strconv.Atoi(l); err == nil && val > 0 && val <= 200 {
			limit = val
		}
	}

	offset := 0
	if o := c.Query("offset"); o != "" {
		if val, err := strconv.Atoi(o); err == nil && val >= 0 {
			offset = val
		}
	}

	messages, err := h.db.ListMessagesByChat(ctx, database.ListMessagesByChatParams{
		ChatID: chatID,
		Limit:  int32(limit),
		Offset: int32(offset),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list messages"})
		return
	}

	formattedMessages := make([]gin.H, 0, len(messages))
	for _, m := range messages {
		var reactionsMap map[string][]string
		if len(m.Reactions) > 0 {
			_ = json.Unmarshal(m.Reactions, &reactionsMap)
		}
		if reactionsMap == nil {
			reactionsMap = make(map[string][]string)
		}

		var replyToObj interface{}
		if len(m.ReplyTo) > 0 {
			_ = json.Unmarshal(m.ReplyTo, &replyToObj)
		}

		var threadLastReplyAt *time.Time
		if m.ThreadLastReplyAt.Valid {
			threadLastReplyAt = &m.ThreadLastReplyAt.Time
		}

		userEmail := ""
		if m.UserEmail.Valid {
			userEmail = m.UserEmail.String
		}
		displayName := ""
		if m.DisplayName.Valid {
			displayName = m.DisplayName.String
		}
		avatarUrl := ""
		if m.AvatarUrl.Valid {
			avatarUrl = m.AvatarUrl.String
		}

		formattedMessages = append(formattedMessages, gin.H{
			"id":                   formatUUID(m.ID),
			"tenant_id":            formatUUID(m.TenantID),
			"workspace_id":         formatUUID(m.WorkspaceID),
			"group_id":             formatUUID(m.GroupID),
			"chat_id":              formatUUID(m.ChatID),
			"user_id":              formatUUID(m.UserID),
			"user_email":           userEmail,
			"display_name":         displayName,
			"avatar_url":           avatarUrl,
			"role":                 m.Role,
			"content":              m.Content,
			"reply_to":             replyToObj,
			"reactions":            reactionsMap,
			"thread_count":         m.ThreadCount,
			"thread_last_reply_at": threadLastReplyAt,
			"is_deleted":           m.IsDeleted,
			"is_edited":            m.IsEdited,
			"created_at":           m.CreatedAt.Time,
			"updated_at":           m.UpdatedAt.Time,
		})
	}

	c.JSON(http.StatusOK, gin.H{"messages": formattedMessages})
}

// GetMessageThread handles GET /api/messages/:id/thread.
func (h *Handler) GetMessageThread(c *gin.Context) {
	ctx := c.Request.Context()

	_, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	messageID, ok := parseUUIDParam(c, "id")
	if !ok {
		return
	}

	replies, err := h.db.ListThreadMessages(ctx, messageID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list thread messages"})
		return
	}

	formattedReplies := make([]gin.H, 0, len(replies))
	for _, r := range replies {
		var avatar *string
		if r.UserAvatar != "" {
			avatar = &r.UserAvatar
		}
		formattedReplies = append(formattedReplies, gin.H{
			"id":          formatUUID(r.ID),
			"content":     r.Content,
			"user_email":  r.UserEmail,
			"user_name":   r.UserName,
			"user_avatar": avatar,
			"created_at":  r.CreatedAt.Time,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"parent_message_id": formatUUID(messageID),
		"replies":           formattedReplies,
	})
}
