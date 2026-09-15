package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// CORSOptions configures the CORS middleware behaviour.
type CORSOptions struct {
	AllowedOrigins   []string
	AllowedMethods   []string
	AllowedHeaders   []string
	AllowCredentials bool
	MaxAgeSeconds    int
}

// DefaultCORSOptions provides sensible defaults for Web and Socket client connectivity.
func DefaultCORSOptions() CORSOptions {
	return CORSOptions{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Requested-With"},
		AllowCredentials: true,
		MaxAgeSeconds:    86400,
	}
}

// CORSMiddleware initializes a configurable CORS handler.
func CORSMiddleware(allowedOrigins ...string) gin.HandlerFunc {
	opts := DefaultCORSOptions()
	if len(allowedOrigins) > 0 {
		opts.AllowedOrigins = allowedOrigins
	}
	return CORSMiddlewareWithOptions(opts)
}

// CORSMiddlewareWithOptions initializes CORS with full custom options.
func CORSMiddlewareWithOptions(opts CORSOptions) gin.HandlerFunc {
	methods := strings.Join(opts.AllowedMethods, ", ")
	headers := strings.Join(opts.AllowedHeaders, ", ")

	isWildcard := false
	for _, o := range opts.AllowedOrigins {
		if o == "*" {
			isWildcard = true
			break
		}
	}

	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")

		if origin != "" {
			allowed := false
			if isWildcard {
				allowed = true
			} else {
				for _, o := range opts.AllowedOrigins {
					if o == origin || strings.EqualFold(o, origin) {
						allowed = true
						break
					}
				}
			}

			if allowed {
				if isWildcard && !opts.AllowCredentials {
					c.Header("Access-Control-Allow-Origin", "*")
				} else {
					c.Header("Access-Control-Allow-Origin", origin)
				}

				if opts.AllowCredentials {
					c.Header("Access-Control-Allow-Credentials", "true")
				}
			}
		} else if isWildcard && !opts.AllowCredentials {
			c.Header("Access-Control-Allow-Origin", "*")
		}

		c.Header("Access-Control-Allow-Methods", methods)
		c.Header("Access-Control-Allow-Headers", headers)
		if opts.MaxAgeSeconds > 0 {
			c.Header("Access-Control-Max-Age", "86400")
		}

		// Handle preflight OPTIONS request
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}
