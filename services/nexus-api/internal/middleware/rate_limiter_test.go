package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

type mockRedisCmdable struct {
	redis.Cmdable
	pipelineFn func() redis.Pipeliner
}

func (m *mockRedisCmdable) Pipeline() redis.Pipeliner {
	if m.pipelineFn != nil {
		return m.pipelineFn()
	}
	return nil
}

type mockPipeliner struct {
	redis.Pipeliner
	zcardVal    int64
	execErr     error
	recordedKey string
}

func (m *mockPipeliner) ZRemRangeByScore(ctx context.Context, key, min, max string) *redis.IntCmd {
	m.recordedKey = key
	return redis.NewIntCmd(ctx)
}

func (m *mockPipeliner) ZAdd(ctx context.Context, key string, members ...redis.Z) *redis.IntCmd {
	return redis.NewIntCmd(ctx)
}

func (m *mockPipeliner) ZCard(ctx context.Context, key string) *redis.IntCmd {
	cmd := redis.NewIntCmd(ctx)
	cmd.SetVal(m.zcardVal)
	return cmd
}

func (m *mockPipeliner) Expire(ctx context.Context, key string, expiration time.Duration) *redis.BoolCmd {
	return redis.NewBoolCmd(ctx)
}

func (m *mockPipeliner) Exec(ctx context.Context) ([]redis.Cmder, error) {
	if m.execErr != nil {
		return nil, m.execErr
	}
	return nil, nil
}

func TestRateLimiter_AllowedUnderLimit(t *testing.T) {
	mockPipe := &mockPipeliner{zcardVal: 5}
	mockClient := &mockRedisCmdable{
		pipelineFn: func() redis.Pipeliner { return mockPipe },
	}

	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(ContextUserIDKey, "user-12345")
		c.Next()
	})
	r.Use(SlidingWindowRateLimiter(mockClient, 30, time.Minute))
	r.GET("/search", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"results": []string{}})
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/search", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}
	if w.Header().Get("X-RateLimit-Limit") != "30" {
		t.Errorf("expected X-RateLimit-Limit 30, got %s", w.Header().Get("X-RateLimit-Limit"))
	}
	if w.Header().Get("X-RateLimit-Remaining") != "25" {
		t.Errorf("expected X-RateLimit-Remaining 25, got %s", w.Header().Get("X-RateLimit-Remaining"))
	}
	if mockPipe.recordedKey != "ratelimit:user-12345" {
		t.Errorf("expected key ratelimit:user-12345, got %s", mockPipe.recordedKey)
	}
}

func TestRateLimiter_ExceededLimit(t *testing.T) {
	mockPipe := &mockPipeliner{zcardVal: 31}
	mockClient := &mockRedisCmdable{
		pipelineFn: func() redis.Pipeliner { return mockPipe },
	}

	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(ContextUserIDKey, "abuser-uuid")
		c.Next()
	})
	r.Use(SlidingWindowRateLimiter(mockClient, 30, time.Minute))
	r.GET("/search", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"results": []string{}})
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/search", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 Too Many Requests, got %d", w.Code)
	}
	if w.Header().Get("Retry-After") != "60" {
		t.Errorf("expected Retry-After 60, got %s", w.Header().Get("Retry-After"))
	}
	if w.Header().Get("X-RateLimit-Remaining") != "0" {
		t.Errorf("expected X-RateLimit-Remaining 0, got %s", w.Header().Get("X-RateLimit-Remaining"))
	}
}

func TestRateLimiter_FailOpenOnRedisError(t *testing.T) {
	mockPipe := &mockPipeliner{execErr: errors.New("redis connection refused")}
	mockClient := &mockRedisCmdable{
		pipelineFn: func() redis.Pipeliner { return mockPipe },
	}

	r := gin.New()
	r.Use(SlidingWindowRateLimiter(mockClient, 30, time.Minute))
	r.GET("/search", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/search", nil)
	r.ServeHTTP(w, req)

	// Fail-open must allow request through with 200 OK
	if w.Code != http.StatusOK {
		t.Fatalf("expected fail-open to return 200 OK, got %d", w.Code)
	}
}

func TestRateLimiter_NilClientPassesThrough(t *testing.T) {
	r := gin.New()
	r.Use(SlidingWindowRateLimiter(nil, 30, time.Minute))
	r.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on nil client, got %d", w.Code)
	}
}
