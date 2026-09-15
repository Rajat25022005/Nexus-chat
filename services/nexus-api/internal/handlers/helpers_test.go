package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestHelpers_GetUserIDFromContext(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("missing user_id in context", func(t *testing.T) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		_, err := getUserIDFromContext(c)
		if err == nil {
			t.Errorf("expected error when user_id is missing from context")
		}
	})

	t.Run("invalid type in context", func(t *testing.T) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Set("user_id", 12345) // int instead of string or pgtype.UUID
		_, err := getUserIDFromContext(c)
		if err == nil {
			t.Errorf("expected error when user_id has invalid type")
		}
	})

	t.Run("invalid UUID string in context", func(t *testing.T) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Set("user_id", "not-a-valid-uuid")
		_, err := getUserIDFromContext(c)
		if err == nil {
			t.Errorf("expected error for malformed UUID string")
		}
	})

	t.Run("valid string UUID in context", func(t *testing.T) {
		rawUUID := uuid.New()
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Set("user_id", rawUUID.String())

		uid, err := getUserIDFromContext(c)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if uid.Bytes != rawUUID {
			t.Errorf("expected %v, got %v", rawUUID, uid.Bytes)
		}
	})

	t.Run("valid uuid.UUID in ContextUserUUIDKey", func(t *testing.T) {
		rawUUID := uuid.New()
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Set("user_uuid", rawUUID)

		uid, err := getUserIDFromContext(c)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if uid.Bytes != rawUUID {
			t.Errorf("expected %v, got %v", rawUUID, uid.Bytes)
		}
	})
}

func TestHelpers_ParseUUIDAndParam(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("parseUUID valid and invalid", func(t *testing.T) {
		raw := uuid.New().String()
		parsed, err := parseUUID(raw)
		if err != nil || !parsed.Valid {
			t.Fatalf("failed to parse valid UUID: %v", err)
		}

		_, err = parseUUID("bad-uuid")
		if err == nil {
			t.Errorf("expected error for bad-uuid, got nil")
		}
	})

	t.Run("parseUUIDParam valid", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		validID := uuid.New().String()
		c.Params = gin.Params{{Key: "id", Value: validID}}

		parsed, ok := parseUUIDParam(c, "id")
		if !ok || !parsed.Valid {
			t.Errorf("expected parseUUIDParam to succeed")
		}
	})

	t.Run("parseUUIDParam invalid responds with 400", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Params = gin.Params{{Key: "id", Value: "invalid-uuid-value"}}

		_, ok := parseUUIDParam(c, "id")
		if ok {
			t.Errorf("expected parseUUIDParam to return false for invalid ID")
		}
		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400 Bad Request, got %d", w.Code)
		}
	})
}

func TestHelpers_FormatAndStringPtr(t *testing.T) {
	t.Run("formatUUID valid and invalid", func(t *testing.T) {
		raw := uuid.New()
		pg := uuidToPg(raw)
		if formatUUID(pg) != raw.String() {
			t.Errorf("expected %s, got %s", raw.String(), formatUUID(pg))
		}

		invalid := pgtype.UUID{Valid: false}
		if formatUUID(invalid) != "" {
			t.Errorf("expected empty string for invalid pgtype.UUID, got %s", formatUUID(invalid))
		}
	})

	t.Run("stringPtrOrNil valid and invalid", func(t *testing.T) {
		validText := textPg("hello")
		ptr := stringPtrOrNil(validText)
		if ptr == nil || *ptr != "hello" {
			t.Errorf("expected pointer to 'hello', got %v", ptr)
		}

		invalidText := pgtype.Text{Valid: false}
		if stringPtrOrNil(invalidText) != nil {
			t.Errorf("expected nil for invalid pgtype.Text")
		}
	})

	t.Run("generateInviteCode format", func(t *testing.T) {
		code, err := generateInviteCode()
		if err != nil {
			t.Fatalf("failed to generate code: %v", err)
		}
		if len(code) != 9 || !strings.Contains(code, "-") {
			t.Errorf("expected format XXXX-XXXX (len 9), got %s", code)
		}
	})

	t.Run("mustJSON valid and fallback", func(t *testing.T) {
		valid := mustJSON(map[string]string{"foo": "bar"})
		if !strings.Contains(string(valid), `"foo":"bar"`) {
			t.Errorf("expected json with foo:bar, got %s", string(valid))
		}

		// Channel types cannot be marshaled
		fallback := mustJSON(make(chan int))
		if string(fallback) != "{}" {
			t.Errorf("expected fallback '{}', got %s", string(fallback))
		}
	})
}
