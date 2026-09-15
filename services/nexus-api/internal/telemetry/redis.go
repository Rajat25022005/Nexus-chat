package telemetry

import (
	"context"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisTelemetry aggregates Redis command latencies, network RTT, and pool wait times.
type RedisTelemetry struct {
	mu sync.RWMutex

	// Overall command latency histogram
	CommandHist *LatencyHistogram `json:"command_hist"`

	// Network RTT histogram (via Ping probe and TCP Dial)
	NetworkRTTHist *LatencyHistogram `json:"network_rtt_hist"`

	// Time waiting for pool connection histogram
	PoolWaitHist *LatencyHistogram `json:"pool_wait_hist"`

	// Per-command latency breakdown
	cmdBreakdown map[string]*LatencyHistogram

	// Counters
	TotalCommands AtomicCounter `json:"total_commands"`
	TotalErrors   AtomicCounter `json:"total_errors"`
}

// GlobalRedisTelemetry is the package-level instance used by the redis hook.
var GlobalRedisTelemetry = NewRedisTelemetry()

// NewRedisTelemetry creates a new RedisTelemetry instance.
func NewRedisTelemetry() *RedisTelemetry {
	return &RedisTelemetry{
		CommandHist:    NewLatencyHistogram(),
		NetworkRTTHist: NewLatencyHistogram(),
		PoolWaitHist:   NewLatencyHistogram(),
		cmdBreakdown:   make(map[string]*LatencyHistogram),
	}
}

// RecordCommand records a command execution duration.
func (t *RedisTelemetry) RecordCommand(cmdName string, d time.Duration) {
	t.CommandHist.Record(d)
	t.TotalCommands.Add(1)

	name := strings.ToUpper(strings.TrimSpace(cmdName))
	t.mu.Lock()
	hist, exists := t.cmdBreakdown[name]
	if !exists {
		hist = NewLatencyHistogram()
		t.cmdBreakdown[name] = hist
	}
	t.mu.Unlock()
	hist.Record(d)
}

// RecordNetworkRTT records a TCP round-trip duration.
func (t *RedisTelemetry) RecordNetworkRTT(d time.Duration) {
	t.NetworkRTTHist.Record(d)
}

// RecordPoolWait records the duration spent acquiring a connection from the pool.
func (t *RedisTelemetry) RecordPoolWait(d time.Duration) {
	t.PoolWaitHist.Record(d)
}

// RedisStatsReport represents the structured report exposed to monitoring.
type RedisStatsReport struct {
	CommandDuration  LatencyStats            `json:"command_duration"`
	NetworkRTT       LatencyStats            `json:"network_rtt"`
	PoolWaitDuration LatencyStats            `json:"pool_wait_duration"`
	TotalCommands    uint64                  `json:"total_commands"`
	TotalErrors      uint64                  `json:"total_errors"`
	CommandBreakdown map[string]LatencyStats `json:"command_breakdown"`
}

// Snapshot returns an immutable snapshot of all Redis telemetry.
func (t *RedisTelemetry) Snapshot() RedisStatsReport {
	t.mu.RLock()
	breakdown := make(map[string]LatencyStats, len(t.cmdBreakdown))
	for k, v := range t.cmdBreakdown {
		breakdown[k] = v.Snapshot()
	}
	t.mu.RUnlock()

	return RedisStatsReport{
		CommandDuration:  t.CommandHist.Snapshot(),
		NetworkRTT:       t.NetworkRTTHist.Snapshot(),
		PoolWaitDuration: t.PoolWaitHist.Snapshot(),
		TotalCommands:    t.TotalCommands.Load(),
		TotalErrors:      t.TotalErrors.Load(),
		CommandBreakdown: breakdown,
	}
}

// RedisHook implements redis.Hook to intercept and record Redis commands and network dials.
type RedisHook struct{}

func (h *RedisHook) DialHook(next redis.DialHook) redis.DialHook {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		start := time.Now()
		conn, err := next(ctx, network, addr)
		rtt := time.Since(start)
		if err == nil {
			GlobalRedisTelemetry.RecordNetworkRTT(rtt)
		}
		return conn, err
	}
}

func (h *RedisHook) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		start := time.Now()
		err := next(ctx, cmd)
		duration := time.Since(start)

		GlobalRedisTelemetry.RecordCommand(cmd.Name(), duration)
		if err != nil && err != redis.Nil {
			GlobalRedisTelemetry.TotalErrors.Add(1)
		}
		return err
	}
}

func (h *RedisHook) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error {
		start := time.Now()
		err := next(ctx, cmds)
		duration := time.Since(start)

		GlobalRedisTelemetry.RecordCommand("PIPELINE", duration)
		if err != nil && err != redis.Nil {
			GlobalRedisTelemetry.TotalErrors.Add(1)
		}
		return err
	}
}

// StartNetworkRTTProbe runs a background ticker measuring Redis network round-trip time.
func StartNetworkRTTProbe(ctx context.Context, client *redis.Client, interval time.Duration) {
	if client == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				start := time.Now()
				pingCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				err := client.Ping(pingCtx).Err()
				cancel()
				if err == nil {
					GlobalRedisTelemetry.RecordNetworkRTT(time.Since(start))
				}
			}
		}
	}()
}
