package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func TestJWTAuthMiddleware_MissingHeader(t *testing.T) {
	r := gin.New()
	r.Use(JWTAuthMiddleware("test-secret"))
	r.GET("/protected", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/protected", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized, got %d", w.Code)
	}
}

func TestJWTAuthMiddleware_InvalidFormat(t *testing.T) {
	r := gin.New()
	r.Use(JWTAuthMiddleware("test-secret"))
	r.GET("/protected", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Token invalidformat")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized, got %d", w.Code)
	}
}

func TestJWTAuthMiddleware_ValidToken(t *testing.T) {
	secret := "test-secret-key-12345"
	validUUID := uuid.New()
	email := "alex@nexus.internal"

	token, err := GenerateJWT(validUUID.String(), email, secret, time.Hour)
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	r := gin.New()
	r.Use(JWTAuthMiddleware(secret))
	r.GET("/protected", func(c *gin.Context) {
		uid, err := GetUserID(c)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		uemail, err := GetUserEmail(c)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		mustUID := MustGetUserID(c)

		c.JSON(http.StatusOK, gin.H{
			"user_id":    uid.String(),
			"must_id":    mustUID.String(),
			"user_email": uemail,
		})
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}
}

func TestJWTAuthMiddleware_WrongSecret(t *testing.T) {
	token, err := GenerateJWT(uuid.NewString(), "user@example.com", "secret-a", time.Hour)
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	r := gin.New()
	r.Use(JWTAuthMiddleware("secret-b"))
	r.GET("/protected", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for wrong secret, got %d", w.Code)
	}
}

func TestJWTAuthMiddleware_ExpiredToken(t *testing.T) {
	secret := "test-secret"
	// Generate token expired 1 hour ago
	now := time.Now().Add(-2 * time.Hour)
	claims := JWTClaims{
		UserID: uuid.NewString(),
		Email:  "expired@example.com",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)), // expired 1 hour ago
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, _ := tok.SignedString([]byte(secret))

	r := gin.New()
	r.Use(JWTAuthMiddleware(secret))
	r.GET("/protected", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for expired token, got %d", w.Code)
	}
}

func TestVerifyJWT_RejectNonHS256Algorithm(t *testing.T) {
	claims := JWTClaims{
		UserID: "test-user",
		Email:  "test@example.com",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	noneToken := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
	tokenStr, _ := noneToken.SignedString(jwt.UnsafeAllowNoneSignatureType)

	_, err := VerifyJWT(tokenStr, "some-secret")
	if err == nil {
		t.Fatalf("expected VerifyJWT to reject none algorithm, but it succeeded")
	}
}
