package middleware

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// SlidingWindowRateLimiter implements a Redis-backed sliding window rate limiter.
func SlidingWindowRateLimiter(rdb redis.Cmdable, maxRequests int, window time.Duration) gin.HandlerFunc {
	return SlidingWindowRateLimiterWithPrefix(rdb, "ratelimit", maxRequests, window)
}

// SlidingWindowRateLimiterWithPrefix implements rate limiting with a designated key prefix.
func SlidingWindowRateLimiterWithPrefix(rdb redis.Cmdable, prefix string, maxRequests int, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		if rdb == nil || maxRequests <= 0 {
			c.Next()
			return
		}

		// Identify subject: prefer authenticated user_id, fallback to client IP
		subject := c.GetString(ContextUserIDKey)
		if subject == "" {
			subject = c.ClientIP()
		}

		key := fmt.Sprintf("%s:%s", prefix, subject)
		now := time.Now().UnixNano()
		windowStart := now - window.Nanoseconds()

		pipe := rdb.Pipeline()

		// 1. Evict entries outside the sliding window
		pipe.ZRemRangeByScore(c.Request.Context(), key, "-inf", strconv.FormatInt(windowStart, 10))

		// 2. Record current request timestamp as score and member
		pipe.ZAdd(c.Request.Context(), key, redis.Z{
			Score:  float64(now),
			Member: strconv.FormatInt(now, 10),
		})

		// 3. Count total active requests in the current sliding window
		cardCmd := pipe.ZCard(c.Request.Context(), key)

		// 4. Refresh key TTL to prevent Redis memory leaks
		pipe.Expire(c.Request.Context(), key, window)

		_, err := pipe.Exec(c.Request.Context())
		if err != nil {
			// Fail-open safety: allow request to proceed if Redis fails
			c.Next()
			return
		}

		count := cardCmd.Val()
		if count > int64(maxRequests) {
			retryAfter := int(window.Seconds())
			if retryAfter <= 0 {
				retryAfter = 1
			}

			c.Header("Retry-After", strconv.Itoa(retryAfter))
			c.Header("X-RateLimit-Limit", strconv.Itoa(maxRequests))
			c.Header("X-RateLimit-Remaining", "0")
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "rate limit exceeded; please try again later",
			})
			return
		}

		remaining := int64(maxRequests) - count
		if remaining < 0 {
			remaining = 0
		}

		c.Header("X-RateLimit-Limit", strconv.Itoa(maxRequests))
		c.Header("X-RateLimit-Remaining", strconv.FormatInt(remaining, 10))
		c.Next()
	}
}
