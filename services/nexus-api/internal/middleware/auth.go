package middleware

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const (
	ContextUserIDKey    = "user_id"
	ContextUserEmailKey = "user_email"
	ContextUserUUIDKey  = "user_uuid"
)

// JWTClaims holds custom authentication claims.
type JWTClaims struct {
	UserID string `json:"user_id"`
	Email  string `json:"email"`
	jwt.RegisteredClaims
}

// GenerateJWT creates an RFC 7519 HMAC-SHA256 token.
func GenerateJWT(userID, email, secret string, expiry time.Duration) (string, error) {
	now := time.Now()
	claims := JWTClaims{
		UserID: userID,
		Email:  email,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(now.Add(expiry)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			Issuer:    "nexus-api",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// VerifyJWT validates the signature, validity window, and HS256 algorithm.
func VerifyJWT(tokenStr, secret string) (*JWTClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &JWTClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok || t.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*JWTClaims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token claims")
	}

	return claims, nil
}

// JWTAuthMiddleware verifies Bearer tokens and injects user claims into context.
func JWTAuthMiddleware(jwtSecret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing authorization header"})
			return
		}

		token := strings.TrimPrefix(authHeader, "Bearer ")
		if token == authHeader || strings.TrimSpace(token) == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid authorization format, expected: Bearer <token>"})
			return
		}

		claims, err := VerifyJWT(strings.TrimSpace(token), jwtSecret)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired token"})
			return
		}

		// Inject user string ID and email
		c.Set(ContextUserIDKey, claims.UserID)
		c.Set(ContextUserEmailKey, claims.Email)

		// Parse and inject typed UUID if valid
		if uid, err := uuid.Parse(claims.UserID); err == nil {
			c.Set(ContextUserUUIDKey, uid)
		}

		c.Next()
	}
}

// GetUserID retrieves the authenticated user's UUID from the Gin context.
func GetUserID(c *gin.Context) (uuid.UUID, error) {
	if val, exists := c.Get(ContextUserUUIDKey); exists {
		if uid, ok := val.(uuid.UUID); ok {
			return uid, nil
		}
	}

	if val, exists := c.Get(ContextUserIDKey); exists {
		if str, ok := val.(string); ok {
			return uuid.Parse(str)
		}
	}

	return uuid.Nil, errors.New("user_id not found in context")
}

// MustGetUserID retrieves the authenticated user's UUID or panics.
func MustGetUserID(c *gin.Context) uuid.UUID {
	uid, err := GetUserID(c)
	if err != nil {
		panic(fmt.Sprintf("MustGetUserID failed: %v", err))
	}
	return uid
}

// GetUserEmail retrieves the authenticated user's email from the Gin context.
func GetUserEmail(c *gin.Context) (string, error) {
	if val, exists := c.Get(ContextUserEmailKey); exists {
		if email, ok := val.(string); ok {
			return email, nil
		}
	}
	return "", errors.New("user_email not found in context")
}
