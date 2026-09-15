package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"nexus/nexus-api/internal/database"
)

var usernameQueryRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]{3,30}$`)

// UserSearchResponseItem represents a sanitized user record for discovery results.
type UserSearchResponseItem struct {
	ID                uuid.UUID `json:"id"`
	Username          *string   `json:"username,omitempty"`
	DisplayName       string    `json:"display_name"`
	AvatarURL         string    `json:"avatar_url,omitempty"`
	Email             string    `json:"email,omitempty"`               // Returned ONLY on exact email search
	EmailMasked       string    `json:"email_masked,omitempty"`        // Always returned
	PhoneNumberMasked string    `json:"phone_number_masked,omitempty"` // Always masked
	CreatedAt         time.Time `json:"created_at"`
}

// UserSearchResponse represents the list payload returned by GET /api/v1/users/search.
type UserSearchResponse struct {
	Users []UserSearchResponseItem `json:"users"`
	Total int                      `json:"total"`
}

// MaskEmail masks the local part of an email address to protect PII against bulk scraping.
// Example: "sarah.connor@nexus.internal" -> "s••••••••••r@nexus.internal"
func MaskEmail(email string) string {
	parts := strings.Split(email, "@")
	if len(parts) != 2 || len(parts[0]) == 0 {
		return "•••••"
	}
	local, domain := parts[0], parts[1]
	if len(local) <= 2 {
		return string(local[0]) + "•••@" + domain
	}
	maskLen := len(local) - 2
	if maskLen > 10 {
		maskLen = 10 // Cap mask length to prevent exact character count leakage
	}
	return fmt.Sprintf("%c%s%c@%s", local[0], strings.Repeat("•", maskLen), local[len(local)-1], domain)
}

// MaskPhoneNumber masks an E.164 phone number, preserving country code and last 4 digits.
// Example: "+14155552671" -> "+1 ••• ••• 2671"
func MaskPhoneNumber(phone string) string {
	cleaned := strings.TrimSpace(phone)
	if len(cleaned) < 7 {
		return "••• ••• ••••"
	}
	countryCode := cleaned[:2] // e.g. "+1"
	last4 := cleaned[len(cleaned)-4:]
	return countryCode + " ••• ••• " + last4
}

// SearchUsers handles GET /api/v1/users/search.
func (h *Handler) SearchUsers(c *gin.Context) {
	ctx := c.Request.Context()

	callerID, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	rawQuery := strings.TrimSpace(c.Query("q"))
	if strings.Contains(c.Request.URL.RawQuery, "q=+") || strings.Contains(c.Request.URL.RawQuery, "&q=+") {
		if !strings.HasPrefix(rawQuery, "+") {
			rawQuery = "+" + rawQuery
		}
	}
	if len(rawQuery) < 3 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "search query must be at least 3 characters"})
		return
	}

	limit := 10
	if l := c.Query("limit"); l != "" {
		if val, err := strconv.Atoi(l); err == nil && val > 0 {
			if val > 50 {
				limit = 50
			} else {
				limit = val
			}
		}
	}

	offset := 0
	if o := c.Query("offset"); o != "" {
		if val, err := strconv.Atoi(o); err == nil && val >= 0 {
			offset = val
		}
	}

	// 1. Exact Email Lookup (Contains '@')
	if strings.Contains(rawQuery, "@") {
		user, err := h.db.SearchUserByExactQuery(ctx, database.SearchUserByExactQueryParams{
			Query:    rawQuery,
			CallerID: callerID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				c.JSON(http.StatusOK, UserSearchResponse{Users: []UserSearchResponseItem{}, Total: 0})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "search query failed"})
			return
		}

		item := buildSearchItem(user, true)
		c.JSON(http.StatusOK, UserSearchResponse{
			Users: []UserSearchResponseItem{item},
			Total: 1,
		})
		return
	}

	// 2. Exact Phone Lookup (Starts with '+')
	if strings.HasPrefix(rawQuery, "+") {
		user, err := h.db.SearchUserByExactQuery(ctx, database.SearchUserByExactQueryParams{
			Query:    rawQuery,
			CallerID: callerID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				c.JSON(http.StatusOK, UserSearchResponse{Users: []UserSearchResponseItem{}, Total: 0})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "search query failed"})
			return
		}

		// Phone search: cleartext email is omitted
		item := buildSearchItem(user, false)
		c.JSON(http.StatusOK, UserSearchResponse{
			Users: []UserSearchResponseItem{item},
			Total: 1,
		})
		return
	}

	// 3. Username Prefix Search
	if !usernameQueryRegex.MatchString(rawQuery) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid username search query: must contain only alphanumeric characters, underscores, or hyphens (3-30 characters)",
		})
		return
	}

	users, err := h.db.SearchUsersByUsernamePrefix(ctx, database.SearchUsersByUsernamePrefixParams{
		Prefix:   rawQuery,
		CallerID: callerID,
		Limit:    int32(limit),
		Offset:   int32(offset),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "search query failed"})
		return
	}

	items := make([]UserSearchResponseItem, 0, len(users))
	for _, u := range users {
		items = append(items, buildSearchItem(u, false))
	}

	c.JSON(http.StatusOK, UserSearchResponse{
		Users: items,
		Total: len(items),
	})
}

// buildSearchItem constructs a UserSearchResponseItem enforcing PII masking rules.
func buildSearchItem(u database.User, includeCleartextEmail bool) UserSearchResponseItem {
	userUUID, _ := uuid.FromBytes(u.ID.Bytes[:])

	var maskedPhone string
	if u.PhoneNumber.Valid && u.PhoneNumber.String != "" {
		maskedPhone = MaskPhoneNumber(u.PhoneNumber.String)
	}

	item := UserSearchResponseItem{
		ID:                userUUID,
		Username:          stringPtrOrNil(u.Username),
		DisplayName:       u.DisplayName,
		AvatarURL:         u.AvatarUrl,
		EmailMasked:       MaskEmail(u.Email),
		PhoneNumberMasked: maskedPhone,
		CreatedAt:         u.CreatedAt.Time,
	}

	if includeCleartextEmail {
		item.Email = u.Email
	}

	return item
}
