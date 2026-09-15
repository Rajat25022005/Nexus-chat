package telemetry

import (
	"math"
	"sync"
	"sync/atomic"
	"time"
)

// defaultBuckets defines exponential latency buckets in microseconds (from 10us to 10s).
var defaultBuckets = []float64{
	5, 10, 25, 50, 100, 200, 500,
	1000, 2000, 5000, 10000, 20000, 50000,
	100000, 200000, 500000,
	1000000, 2000000, 5000000, 10000000,
}

// LatencyStats represents statistical quantiles and summaries in milliseconds.
type LatencyStats struct {
	Count uint64  `json:"count"`
	MinMs float64 `json:"min_ms"`
	AvgMs float64 `json:"avg_ms"`
	P50Ms float64 `json:"p50_ms"`
	P90Ms float64 `json:"p90_ms"`
	P95Ms float64 `json:"p95_ms"`
	P99Ms float64 `json:"p99_ms"`
	MaxMs float64 `json:"max_ms"`
}

// LatencyHistogram provides thread-safe, high-frequency recording of operation durations.
type LatencyHistogram struct {
	mu       sync.RWMutex
	buckets  []float64
	counts   []uint64
	overflow uint64
	count    uint64
	sumUs    uint64
	minUs    uint64
	maxUs    uint64
}

// NewLatencyHistogram initializes a new latency histogram with standard microsecond buckets.
func NewLatencyHistogram() *LatencyHistogram {
	return &LatencyHistogram{
		buckets: defaultBuckets,
		counts:  make([]uint64, len(defaultBuckets)),
		minUs:   math.MaxUint64,
	}
}

// Record records a duration into the histogram.
func (h *LatencyHistogram) Record(d time.Duration) {
	us := uint64(d.Microseconds())
	if us == 0 && d > 0 {
		us = 1
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	h.count++
	h.sumUs += us

	if us < h.minUs {
		h.minUs = us
	}
	if us > h.maxUs {
		h.maxUs = us
	}

	for i, bound := range h.buckets {
		if float64(us) <= bound {
			h.counts[i]++
			return
		}
	}
	h.overflow++
}

// Snapshot calculates quantiles and returns an immutable LatencyStats summary.
func (h *LatencyHistogram) Snapshot() LatencyStats {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if h.count == 0 {
		return LatencyStats{}
	}

	total := h.count
	avgMs := (float64(h.sumUs) / float64(total)) / 1000.0
	minMs := float64(h.minUs) / 1000.0
	maxMs := float64(h.maxUs) / 1000.0
	if h.minUs == math.MaxUint64 {
		minMs = 0
	}

	quantile := func(q float64) float64 {
		target := uint64(math.Ceil(float64(total) * q))
		if target == 0 {
			target = 1
		}
		var accum uint64
		for i, c := range h.counts {
			accum += c
			if accum >= target {
				return h.buckets[i] / 1000.0
			}
		}
		return maxMs
	}

	return LatencyStats{
		Count: total,
		MinMs: minMs,
		AvgMs: avgMs,
		P50Ms: quantile(0.50),
		P90Ms: quantile(0.90),
		P95Ms: quantile(0.95),
		P99Ms: quantile(0.99),
		MaxMs: maxMs,
	}
}

// Reset clears the recorded data in the histogram.
func (h *LatencyHistogram) Reset() {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.count = 0
	h.sumUs = 0
	h.overflow = 0
	h.minUs = math.MaxUint64
	h.maxUs = 0
	for i := range h.counts {
		h.counts[i] = 0
	}
}

// AtomicCounter encapsulates an atomic 64-bit integer.
type AtomicCounter struct {
	val uint64
}

func (c *AtomicCounter) Add(delta uint64) {
	atomic.AddUint64(&c.val, delta)
}

func (c *AtomicCounter) Load() uint64 {
	return atomic.LoadUint64(&c.val)
}

func (c *AtomicCounter) Reset() {
	atomic.StoreUint64(&c.val, 0)
}
