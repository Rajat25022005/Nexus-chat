package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCORSMiddleware_Preflight(t *testing.T) {
	r := gin.New()
	r.Use(CORSMiddleware("https://app.nexusainow.online"))
	r.POST("/api/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodOptions, "/api/test", nil)
	req.Header.Set("Origin", "https://app.nexusainow.online")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content for OPTIONS preflight, got %d", w.Code)
	}

	if w.Header().Get("Access-Control-Allow-Origin") != "https://app.nexusainow.online" {
		t.Errorf("expected Access-Control-Allow-Origin header, got %s", w.Header().Get("Access-Control-Allow-Origin"))
	}
	if w.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Errorf("expected Access-Control-Allow-Credentials true, got %s", w.Header().Get("Access-Control-Allow-Credentials"))
	}
}

func TestCORSMiddleware_WildcardOrigin(t *testing.T) {
	r := gin.New()
	opts := DefaultCORSOptions()
	opts.AllowCredentials = false
	opts.AllowedOrigins = []string{"*"}
	r.Use(CORSMiddlewareWithOptions(opts))
	r.GET("/api/public", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/public", nil)
	req.Header.Set("Origin", "https://somewebsite.com")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", w.Code)
	}
	if w.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Errorf("expected Access-Control-Allow-Origin *, got %s", w.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestCORSMiddleware_DisallowedOrigin(t *testing.T) {
	r := gin.New()
	r.Use(CORSMiddleware("https://trusted.nexusainow.online"))
	r.GET("/api/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/test", nil)
	req.Header.Set("Origin", "https://malicious.example.com")
	r.ServeHTTP(w, req)

	if w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("expected empty Access-Control-Allow-Origin for disallowed origin, got %s", w.Header().Get("Access-Control-Allow-Origin"))
	}
}
