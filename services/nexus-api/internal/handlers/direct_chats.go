package handlers

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"nexus/nexus-api/internal/database"
	"nexus/nexus-api/internal/services"
	"nexus/nexus-api/internal/telemetry"
)

type CreateDirectChatRequest struct {
	RecipientID string `json:"recipient_id" binding:"required"`
}

type DirectChatRecipientInfo struct {
	ID          uuid.UUID `json:"id"`
	DisplayName string    `json:"display_name"`
	Username    *string   `json:"username,omitempty"`
	AvatarURL   string    `json:"avatar_url,omitempty"`
}

type DirectChatResponse struct {
	ChatID       uuid.UUID               `json:"chat_id"`
	DirectChatID uuid.UUID               `json:"direct_chat_id"`
	Recipient    DirectChatRecipientInfo `json:"recipient"`
	CreatedAt    time.Time               `json:"created_at"`
	IsNew        bool                    `json:"is_new"`
}

// isUniqueViolation checks whether an error is a PostgreSQL 23505 unique violation.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "23505") || strings.Contains(msg, "unique_violation") || strings.Contains(msg, "uq_direct_chat_pair")
}

// CreateDirectChat handles POST /api/v1/chats/direct.
func (h *Handler) CreateDirectChat(c *gin.Context) {
	ctx := c.Request.Context()

	callerID, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req CreateDirectChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "recipient_id is required"})
		return
	}

	recipientID, err := parseUUID(req.RecipientID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid recipient_id format"})
		return
	}

	// 1. Self-chat rejection
	if callerID == recipientID || bytes.Equal(callerID.Bytes[:], recipientID.Bytes[:]) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot message yourself"})
		return
	}

	// 2. Verify recipient exists
	recipientUser, err := h.db.GetUserByID(ctx, recipientID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "recipient not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query recipient"})
		return
	}

	// 3. Bidirectional user block check
	isBlocked, err := h.db.CheckUsersBlocked(ctx, database.CheckUsersBlockedParams{
		UserAID: callerID,
		UserBID: recipientID,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check user blocks"})
		return
	}
	if isBlocked {
		c.JSON(http.StatusForbidden, gin.H{"error": "cannot initiate conversation with this user"})
		return
	}

	// 4. Canonical user ordering: userA < userB
	var userAID, userBID pgtype.UUID
	if bytes.Compare(callerID.Bytes[:], recipientID.Bytes[:]) < 0 {
		userAID = callerID
		userBID = recipientID
	} else {
		userAID = recipientID
		userBID = callerID
	}

	// 5. Atomic single-round-trip resolution & provisioning (Zero transaction checkout hold)
	t0 := time.Now()
	res, err := h.db.CreateOrGetDirectChatAtomic(ctx, database.CreateOrGetDirectChatAtomicParams{
		UserAID:  userAID,
		UserBID:  userBID,
		CallerID: callerID,
	})
	dur := time.Since(t0)
	telemetry.GlobalDBTelemetry.RecordTxDuration(dur)
	telemetry.GlobalDBTelemetry.RecordTxSegment("atomic_cte_total", dur)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve direct chat"})
		return
	}

	// 6. Publish real-time notification event over Redis if newly created
	if res.IsNew {
		h.publishDirectChatCreated(ctx, recipientID, res.ChatID, callerID)
	}

	statusCode := http.StatusOK
	if res.IsNew {
		statusCode = http.StatusCreated
	}

	c.JSON(statusCode, formatDirectChatResponse(
		res.ID,
		res.ChatID,
		recipientUser,
		res.CreatedAt.Time,
		res.IsNew,
	))
}

// publishDirectChatCreated dispatches an event to the recipient's personal topic over Redis.
func (h *Handler) publishDirectChatCreated(ctx context.Context, recipientID, chatID, callerID pgtype.UUID) {
	if h.redis == nil {
		return
	}

	recipientUUID, err1 := uuid.FromBytes(recipientID.Bytes[:])
	chatUUID, err2 := uuid.FromBytes(chatID.Bytes[:])
	callerUUID, err3 := uuid.FromBytes(callerID.Bytes[:])
	if err1 != nil || err2 != nil || err3 != nil {
		return
	}

	callerName := ""
	if callerUser, err := h.db.GetUserByID(ctx, callerID); err == nil {
		callerName = callerUser.DisplayName
	}

	_ = h.redis.PublishDirectChatCreated(ctx, recipientUUID, services.DirectChatCreatedPayload{
		ChatID:        chatUUID,
		InitiatorID:   callerUUID,
		InitiatorName: callerName,
		CreatedAt:     time.Now().UTC(),
	})
}

// formatDirectChatResponse shapes the standardized direct chat payload.
func formatDirectChatResponse(
	dcID, chatID pgtype.UUID,
	recipient database.User,
	createdAt time.Time,
	isNew bool,
) DirectChatResponse {
	dcUUID, _ := uuid.FromBytes(dcID.Bytes[:])
	cUUID, _ := uuid.FromBytes(chatID.Bytes[:])
	rUUID, _ := uuid.FromBytes(recipient.ID.Bytes[:])

	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}

	return DirectChatResponse{
		ChatID:       cUUID,
		DirectChatID: dcUUID,
		Recipient: DirectChatRecipientInfo{
			ID:          rUUID,
			DisplayName: recipient.DisplayName,
			Username:    stringPtrOrNil(recipient.Username),
			AvatarURL:   recipient.AvatarUrl,
		},
		CreatedAt: createdAt,
		IsNew:     isNew,
	}
}
