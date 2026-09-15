package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"nexus/nexus-api/internal/config"
)

func TestGetRuntimeMetrics(t *testing.T) {
	cfg := &config.Config{JWTSecret: "test-secret-key-12345"}
	h := New(&MockQuerier{}, nil, nil, nil, cfg)

	router := setupTestRouter()
	h.RegisterRoutes(router)

	req, _ := http.NewRequest("GET", "/metrics/runtime", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var resp RuntimeMetricsResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode metrics response: %v", err)
	}

	if resp.GoroutineCount <= 0 {
		t.Errorf("expected positive goroutine count, got %d", resp.GoroutineCount)
	}
	if resp.RuntimeMetrics == nil {
		t.Fatalf("expected runtime_metrics map to be non-nil")
	}

	// Verify required runtime/metrics fields
	requiredMetrics := []string{
		"/gc/heap/allocs:bytes",
		"/gc/heap/objects:objects",
		"/gc/cycles/total:gc-cycles",
		"/sched/latencies:seconds",
	}

	for _, m := range requiredMetrics {
		if _, ok := resp.RuntimeMetrics[m]; !ok {
			t.Errorf("missing expected runtime metric: %s", m)
		}
	}
}
