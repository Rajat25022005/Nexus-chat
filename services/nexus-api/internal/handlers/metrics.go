package handlers

import (
	"net/http"
	"runtime"
	"runtime/metrics"
	"time"

	"github.com/gin-gonic/gin"

	"nexus/nexus-api/internal/telemetry"
)

// HistogramStats provides statistical percentiles computed from a runtime/metrics histogram.
type HistogramStats struct {
	Count uint64  `json:"count"`
	Min   float64 `json:"min"`
	P50   float64 `json:"p50"`
	P90   float64 `json:"p90"`
	P95   float64 `json:"p95"`
	P99   float64 `json:"p99"`
	Max   float64 `json:"max"`
}

// RuntimeMetricsResponse shapes the telemetry payload returned by GET /metrics/runtime.
type RuntimeMetricsResponse struct {
	Timestamp       time.Time                   `json:"timestamp"`
	UptimeSeconds   float64                     `json:"uptime_seconds"`
	GoroutineCount  int                         `json:"goroutine_count"`
	GOMAXPROCS      int                         `json:"gomaxprocs"`
	RuntimeMetrics  map[string]interface{}      `json:"runtime_metrics"`
	HeapStats       HeapSummary                 `json:"heap_stats"`
	CPURuntimeStats CPUSummary                  `json:"cpu_runtime_stats"`
	DBPoolStats     *DBPoolSummary              `json:"db_pool_stats,omitempty"`
	DBTelemetry     *telemetry.DBStatsReport    `json:"db_telemetry,omitempty"`
	RedisStats      *RedisSummary               `json:"redis_stats,omitempty"`
	RedisTelemetry  *telemetry.RedisStatsReport `json:"redis_telemetry,omitempty"`
}

type HeapSummary struct {
	AllocBytes        uint64  `json:"alloc_bytes"`
	AllocMB           float64 `json:"alloc_mb"`
	TotalAllocBytes   uint64  `json:"total_alloc_bytes"`
	TotalAllocMB      float64 `json:"total_alloc_mb"`
	SysBytes          uint64  `json:"sys_bytes"`
	SysMB             float64 `json:"sys_mb"`
	HeapObjects       uint64  `json:"heap_objects"`
	LiveHeapObjectsMB float64 `json:"live_heap_objects_mb"`
	NumGC             uint32  `json:"num_gc"`
	GCCPUPraction     float64 `json:"gc_cpu_fraction"`
}

type CPUSummary struct {
	TotalCPUSec  float64 `json:"total_cpu_seconds"`
	GCCPUSec     float64 `json:"gc_cpu_seconds"`
	GCCPUPercent float64 `json:"gc_cpu_percent"`
}

type DBPoolSummary struct {
	AcquiredConns      int32   `json:"acquired_conns"`
	IdleConns          int32   `json:"idle_conns"`
	TotalConns         int32   `json:"total_conns"`
	MaxConns           int32   `json:"max_conns"`
	AcquireCount       int64   `json:"acquire_count"`
	EmptyAcquireCount  int64   `json:"empty_acquire_count"`
	AcquireDurationMs  float64 `json:"acquire_duration_ms"`
	EmptyAcquireWaitMs float64 `json:"empty_acquire_wait_ms"`
	AvgAcquireWaitMs   float64 `json:"avg_acquire_wait_ms"`
}

type RedisSummary struct {
	Hits              uint32  `json:"hits"`
	Misses            uint32  `json:"misses"`
	Timeouts          uint32  `json:"timeouts"`
	WaitCount         uint32  `json:"wait_count"`
	WaitDurationUs    int64   `json:"wait_duration_us"`
	AvgWaitDurationUs float64 `json:"avg_wait_duration_us"`
	TotalConns        uint32  `json:"total_conns"`
	IdleConns         uint32  `json:"idle_conns"`
	StaleConns        uint32  `json:"stale_conns"`
}

var serverStartTime = time.Now()

func computeHistogram(h *metrics.Float64Histogram) HistogramStats {
	var total uint64
	for _, c := range h.Counts {
		total += c
	}
	if total == 0 || len(h.Counts) == 0 {
		return HistogramStats{}
	}

	var minVal, maxVal float64
	foundMin := false
	for i, c := range h.Counts {
		if c > 0 {
			if !foundMin {
				minVal = h.Buckets[i]
				foundMin = true
			}
			maxVal = h.Buckets[i+1]
		}
	}

	quantile := func(q float64) float64 {
		target := uint64(float64(total) * q)
		if target == 0 {
			target = 1
		}
		var accum uint64
		for i, c := range h.Counts {
			accum += c
			if accum >= target {
				return h.Buckets[i+1]
			}
		}
		return maxVal
	}

	return HistogramStats{
		Count: total,
		Min:   minVal,
		P50:   quantile(0.50),
		P90:   quantile(0.90),
		P95:   quantile(0.95),
		P99:   quantile(0.99),
		Max:   maxVal,
	}
}

// GetRuntimeMetrics handles GET /metrics/runtime.
func (h *Handler) GetRuntimeMetrics(c *gin.Context) {
	// 1. Read Go runtime/metrics samples
	metricNames := []string{
		"/gc/heap/allocs:bytes",
		"/gc/heap/objects:objects",
		"/gc/cycles/total:gc-cycles",
		"/gc/cycles/pauses:seconds",
		"/sched/pauses/total/gc:seconds",
		"/sched/latencies:seconds",
		"/sched/goroutines:goroutines",
		"/memory/classes/heap/objects:bytes",
		"/cpu/classes/gc/total:cpu-seconds",
		"/cpu/classes/total:cpu-seconds",
	}

	samples := make([]metrics.Sample, len(metricNames))
	for i, name := range metricNames {
		samples[i].Name = name
	}
	metrics.Read(samples)

	collected := make(map[string]interface{})
	var totalCPUSec, gcCPUSec float64

	for _, sample := range samples {
		switch sample.Value.Kind() {
		case metrics.KindUint64:
			collected[sample.Name] = sample.Value.Uint64()
		case metrics.KindFloat64:
			val := sample.Value.Float64()
			collected[sample.Name] = val
			if sample.Name == "/cpu/classes/total:cpu-seconds" {
				totalCPUSec = val
			} else if sample.Name == "/cpu/classes/gc/total:cpu-seconds" {
				gcCPUSec = val
			}
		case metrics.KindFloat64Histogram:
			hist := sample.Value.Float64Histogram()
			stats := computeHistogram(hist)
			collected[sample.Name] = stats
		}
	}

	// 2. Read MemStats
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	gcCPUPercent := 0.0
	if totalCPUSec > 0 {
		gcCPUPercent = (gcCPUSec / totalCPUSec) * 100.0
	} else if memStats.GCCPUFraction > 0 {
		gcCPUPercent = memStats.GCCPUFraction * 100.0
	}

	var liveHeapMB float64
	if v, ok := collected["/memory/classes/heap/objects:bytes"].(uint64); ok {
		liveHeapMB = float64(v) / (1024 * 1024)
	} else {
		liveHeapMB = float64(memStats.HeapAlloc) / (1024 * 1024)
	}

	resp := RuntimeMetricsResponse{
		Timestamp:      time.Now().UTC(),
		UptimeSeconds:  time.Since(serverStartTime).Seconds(),
		GoroutineCount: runtime.NumGoroutine(),
		GOMAXPROCS:     runtime.GOMAXPROCS(0),
		RuntimeMetrics: collected,
		HeapStats: HeapSummary{
			AllocBytes:        memStats.Alloc,
			AllocMB:           float64(memStats.Alloc) / (1024 * 1024),
			TotalAllocBytes:   memStats.TotalAlloc,
			TotalAllocMB:      float64(memStats.TotalAlloc) / (1024 * 1024),
			SysBytes:          memStats.Sys,
			SysMB:             float64(memStats.Sys) / (1024 * 1024),
			HeapObjects:       memStats.HeapObjects,
			LiveHeapObjectsMB: liveHeapMB,
			NumGC:             memStats.NumGC,
			GCCPUPraction:     memStats.GCCPUFraction,
		},
		CPURuntimeStats: CPUSummary{
			TotalCPUSec:  totalCPUSec,
			GCCPUSec:     gcCPUSec,
			GCCPUPercent: gcCPUPercent,
		},
	}

	// 3. PostgreSQL Connection Pool Stats & Telemetry
	var acqDurMs float64
	if h.pool != nil {
		pStat := h.pool.Stat()
		acqDurMs = float64(pStat.AcquireDuration().Microseconds()) / 1000.0
		emptyWaitMs := float64(pStat.EmptyAcquireWaitTime().Microseconds()) / 1000.0
		var avgWaitMs float64
		if pStat.AcquireCount() > 0 {
			avgWaitMs = acqDurMs / float64(pStat.AcquireCount())
		}

		resp.DBPoolStats = &DBPoolSummary{
			AcquiredConns:      pStat.AcquiredConns(),
			IdleConns:          pStat.IdleConns(),
			TotalConns:         pStat.TotalConns(),
			MaxConns:           pStat.MaxConns(),
			AcquireCount:       pStat.AcquireCount(),
			EmptyAcquireCount:  pStat.EmptyAcquireCount(),
			AcquireDurationMs:  acqDurMs,
			EmptyAcquireWaitMs: emptyWaitMs,
			AvgAcquireWaitMs:   avgWaitMs,
		}
	}

	dbSnapshot := telemetry.GlobalDBTelemetry.SnapshotWithPool(acqDurMs / 1000.0)
	resp.DBTelemetry = &dbSnapshot

	// 4. Redis Connection Pool Stats & Telemetry
	if h.redis != nil && h.redis.Client() != nil {
		rStat := h.redis.Client().PoolStats()
		waitDurUs := rStat.WaitDurationNs / 1000
		var avgWaitUs float64
		if rStat.WaitCount > 0 {
			avgWaitUs = float64(waitDurUs) / float64(rStat.WaitCount)
		}

		resp.RedisStats = &RedisSummary{
			Hits:              rStat.Hits,
			Misses:            rStat.Misses,
			Timeouts:          rStat.Timeouts,
			WaitCount:         rStat.WaitCount,
			WaitDurationUs:    waitDurUs,
			AvgWaitDurationUs: avgWaitUs,
			TotalConns:        rStat.TotalConns,
			IdleConns:         rStat.IdleConns,
			StaleConns:        rStat.StaleConns,
		}
	}

	redisSnapshot := telemetry.GlobalRedisTelemetry.Snapshot()
	resp.RedisTelemetry = &redisSnapshot

	c.JSON(http.StatusOK, resp)
}
