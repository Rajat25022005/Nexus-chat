package telemetry

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

type dbCtxKey struct{}

type queryStartMeta struct {
	startTime time.Time
	sql       string
}

// DBTelemetry aggregates PostgreSQL query, transaction, connection acquisition, and lock metrics.
type DBTelemetry struct {
	mu sync.RWMutex

	// Latency histograms
	WaitForConnHist *LatencyHistogram `json:"wait_for_conn_hist"`
	QueryExecHist   *LatencyHistogram `json:"query_exec_hist"`
	TxDurationHist  *LatencyHistogram `json:"tx_duration_hist"`
	LockWaitHist    *LatencyHistogram `json:"lock_wait_hist"`

	// Rows metrics
	RowsScanned  AtomicCounter `json:"rows_scanned"`
	RowsReturned AtomicCounter `json:"rows_returned"`

	// Cumulative execution time vs wait time
	TotalWaitTimeUs  AtomicCounter `json:"total_wait_time_us"`
	TotalQueryTimeUs AtomicCounter `json:"total_query_time_us"`
	TotalTxTimeUs    AtomicCounter `json:"total_tx_time_us"`

	// Query breakdown by table/type
	queryBreakdown map[string]*LatencyHistogram

	// Transaction segment breakdown (every step measured)
	txSegments map[string]*LatencyHistogram
}

// GlobalDBTelemetry is the package-level instance used by the pgx tracer and handlers.
var GlobalDBTelemetry = NewDBTelemetry()

// NewDBTelemetry instantiates a new DBTelemetry instance.
func NewDBTelemetry() *DBTelemetry {
	return &DBTelemetry{
		WaitForConnHist: NewLatencyHistogram(),
		QueryExecHist:   NewLatencyHistogram(),
		TxDurationHist:  NewLatencyHistogram(),
		LockWaitHist:    NewLatencyHistogram(),
		queryBreakdown:  make(map[string]*LatencyHistogram),
		txSegments:      make(map[string]*LatencyHistogram),
	}
}

// RecordTxSegment records the duration of an individual segment within a transaction lifecycle.
func (t *DBTelemetry) RecordTxSegment(segment string, d time.Duration) {
	t.mu.Lock()
	hist, exists := t.txSegments[segment]
	if !exists {
		hist = NewLatencyHistogram()
		t.txSegments[segment] = hist
	}
	t.mu.Unlock()
	hist.Record(d)
}

// RecordWaitForConn records the duration spent waiting to acquire a connection from the pool.
func (t *DBTelemetry) RecordWaitForConn(d time.Duration) {
	t.WaitForConnHist.Record(d)
	t.TotalWaitTimeUs.Add(uint64(d.Microseconds()))
}

// RecordQueryExec records the execution duration of a SQL query.
func (t *DBTelemetry) RecordQueryExec(sql string, d time.Duration, rowsAffected int64) {
	t.QueryExecHist.Record(d)
	t.TotalQueryTimeUs.Add(uint64(d.Microseconds()))

	if rowsAffected > 0 {
		t.RowsReturned.Add(uint64(rowsAffected))
	}

	// Classify query category
	category := classifySQL(sql)
	t.mu.Lock()
	hist, exists := t.queryBreakdown[category]
	if !exists {
		hist = NewLatencyHistogram()
		t.queryBreakdown[category] = hist
	}
	t.mu.Unlock()
	hist.Record(d)
}

// RecordTxDuration records the complete lifecycle duration of a transaction (Begin -> Commit/Rollback).
func (t *DBTelemetry) RecordTxDuration(d time.Duration) {
	t.TxDurationHist.Record(d)
	t.TotalTxTimeUs.Add(uint64(d.Microseconds()))
}

// RecordLockWait records lock acquisition wait time.
func (t *DBTelemetry) RecordLockWait(d time.Duration) {
	t.LockWaitHist.Record(d)
}

// RecordRowsScanned records rows read from the database.
func (t *DBTelemetry) RecordRowsScanned(count uint64) {
	t.RowsScanned.Add(count)
}

func classifySQL(sql string) string {
	trimmed := strings.ToUpper(strings.TrimSpace(sql))
	if strings.HasPrefix(trimmed, "SELECT") {
		if strings.Contains(trimmed, "FROM USERS") {
			return "SELECT users"
		}
		if strings.Contains(trimmed, "FROM GROUPS") {
			return "SELECT groups"
		}
		if strings.Contains(trimmed, "FROM CHATS") {
			return "SELECT chats"
		}
		if strings.Contains(trimmed, "FROM MESSAGES") {
			return "SELECT messages"
		}
		return "SELECT other"
	}
	if strings.HasPrefix(trimmed, "INSERT") {
		return "INSERT"
	}
	if strings.HasPrefix(trimmed, "UPDATE") {
		return "UPDATE"
	}
	if strings.HasPrefix(trimmed, "DELETE") {
		return "DELETE"
	}
	return "OTHER"
}

// DBStatsReport represents the structured report exposed to monitoring.
type DBStatsReport struct {
	WaitForConnDuration LatencyStats            `json:"wait_for_connection_duration"`
	QueryExecDuration   LatencyStats            `json:"query_execution_duration"`
	TxDuration          LatencyStats            `json:"transaction_duration"`
	LockWaitDuration    LatencyStats            `json:"lock_wait_duration"`
	RowsScanned         uint64                  `json:"rows_scanned"`
	RowsReturned        uint64                  `json:"rows_returned"`
	TotalWaitTimeSec    float64                 `json:"total_wait_time_seconds"`
	TotalQueryTimeSec   float64                 `json:"total_query_time_seconds"`
	TotalTxTimeSec      float64                 `json:"total_tx_time_seconds"`
	WaitVsExecRatio     float64                 `json:"wait_vs_exec_ratio"`
	QueryBreakdown      map[string]LatencyStats `json:"query_breakdown"`
	TxSegments          map[string]LatencyStats `json:"tx_segments"`
}

// Snapshot returns an immutable snapshot of all DB telemetry.
func (t *DBTelemetry) Snapshot() DBStatsReport {
	waitSec := float64(t.TotalWaitTimeUs.Load()) / 1000000.0
	querySec := float64(t.TotalQueryTimeUs.Load()) / 1000000.0

	var ratio float64
	if querySec > 0 {
		ratio = waitSec / querySec
	}

	t.mu.RLock()
	breakdown := make(map[string]LatencyStats, len(t.queryBreakdown))
	for k, v := range t.queryBreakdown {
		breakdown[k] = v.Snapshot()
	}

	segments := make(map[string]LatencyStats, len(t.txSegments))
	for k, v := range t.txSegments {
		segments[k] = v.Snapshot()
	}
	t.mu.RUnlock()

	return DBStatsReport{
		WaitForConnDuration: t.WaitForConnHist.Snapshot(),
		QueryExecDuration:   t.QueryExecHist.Snapshot(),
		TxDuration:          t.TxDurationHist.Snapshot(),
		LockWaitDuration:    t.LockWaitHist.Snapshot(),
		RowsScanned:         t.RowsScanned.Load(),
		RowsReturned:        t.RowsReturned.Load(),
		TotalWaitTimeSec:    waitSec,
		TotalQueryTimeSec:   querySec,
		TotalTxTimeSec:      float64(t.TotalTxTimeUs.Load()) / 1000000.0,
		WaitVsExecRatio:     ratio,
		QueryBreakdown:      breakdown,
		TxSegments:          segments,
	}
}

// SnapshotWithPool returns an immutable snapshot augmented with pgxpool acquire metrics.
func (t *DBTelemetry) SnapshotWithPool(poolAcquireSec float64) DBStatsReport {
	report := t.Snapshot()
	if poolAcquireSec > report.TotalWaitTimeSec {
		report.TotalWaitTimeSec = poolAcquireSec
		if report.TotalQueryTimeSec > 0 {
			report.WaitVsExecRatio = report.TotalWaitTimeSec / report.TotalQueryTimeSec
		}
	}
	return report
}

// PGXQueryTracer implements pgx.QueryTracer to measure query execution duration.
type PGXQueryTracer struct{}

func (tr *PGXQueryTracer) TraceQueryStart(ctx context.Context, conn *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	return context.WithValue(ctx, dbCtxKey{}, queryStartMeta{
		startTime: time.Now(),
		sql:       data.SQL,
	})
}

func (tr *PGXQueryTracer) TraceQueryEnd(ctx context.Context, conn *pgx.Conn, data pgx.TraceQueryEndData) {
	val := ctx.Value(dbCtxKey{})
	if val == nil {
		return
	}
	meta, ok := val.(queryStartMeta)
	if !ok {
		return
	}

	duration := time.Since(meta.startTime)
	var rows int64
	if data.CommandTag.RowsAffected() > 0 {
		rows = data.CommandTag.RowsAffected()
	}

	GlobalDBTelemetry.RecordQueryExec(meta.sql, duration, rows)
}
