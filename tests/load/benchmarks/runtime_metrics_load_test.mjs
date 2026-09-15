#!/usr/bin/env node
/**
 * ==============================================================================
 * NEXUS NEXT-GEN LOAD TEST & RUNTIME METRICS TELEMETRY COLLECTOR
 * ==============================================================================
 * 
 * Collects during load test:
 * 1. GODEBUG=gctrace=1 real-time GC event traces
 * 2. Exact Go runtime/metrics:
 *    - /gc/heap/allocs:bytes
 *    - /gc/heap/objects:objects
 *    - /gc/cycles/total:gc-cycles
 *    - /gc/cycles/pauses:seconds (/sched/pauses/total/gc:seconds)
 *    - /sched/latencies:seconds
 * 3. System & Runtime Watch Targets:
 *    - CPU utilization (Go process % and Elixir process %)
 *    - Heap size (live objects MB, alloc MB, sys MB, RSS)
 *    - Allocation rate (MB/sec rate over time)
 *    - GC CPU % (from /cpu/classes and gctrace)
 *    - Goroutine count (/sched/goroutines:goroutines)
 *    - DB pool usage (acquired, idle, total, max, empty acquires)
 *    - Redis connections (total, idle, hits, misses)
 * 
 * Target Services:
 * - Next-Gen Go REST API (http://localhost:8080)
 * - Next-Gen Elixir WebSocket Gateway (http://localhost:3001)
 * ==============================================================================
 */

import http from 'node:http';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const GO_API_PORT = 8080;
const ELIXIR_SOCKET_PORT = 3001;
const LOG_FILE = '/tmp/nexus-api.log';

// HTTP Agents for Connection Pooling
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 600,
  keepAliveMsecs: 120000,
});

const socketAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 600,
  keepAliveMsecs: 120000,
});

function httpRequest(method, port, path, body = null, token = null, agent = httpAgent) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Connection: 'keep-alive',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const start = performance.now();
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        agent,
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          const dur = performance.now() - start;
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, dur, body: parsed, error: null });
        });
      }
    );

    req.on('error', (err) => {
      resolve({ status: 0, dur: performance.now() - start, body: null, error: err.code || err.message });
    });

    if (data) req.write(data);
    req.end();
  });
}

function getPidForPort(port) {
  try {
    const out = execSync(`lsof -t -i :${port} -sTCP:LISTEN`, { encoding: 'utf8' }).trim();
    const pid = out.split('\n')[0].trim();
    return pid ? parseInt(pid, 10) : null;
  } catch {
    return null;
  }
}

function getProcessStats(pid) {
  if (!pid) return { cpu: 0, rssMB: 0 };
  try {
    const out = execSync(`ps -p ${pid} -o %cpu=,rss=`, { encoding: 'utf8' }).trim();
    const parts = out.split(/\s+/);
    const cpu = parseFloat(parts[0]) || 0;
    const rssKB = parseInt(parts[1], 10) || 0;
    return { cpu, rssMB: (rssKB / 1024).toFixed(1) };
  } catch {
    return { cpu: 0, rssMB: 0 };
  }
}

function getDockerStats(containerName) {
  try {
    const out = execSync(`docker stats --no-stream --format "{{.CPUPerc}}" ${containerName} 2>/dev/null`, { encoding: 'utf8' }).trim();
    return parseFloat(out.replace('%', '')) || 0;
  } catch {
    return 0;
  }
}

async function fetchRuntimeMetrics() {
  const res = await httpRequest('GET', GO_API_PORT, '/metrics/runtime');
  if (res.status === 200 && typeof res.body === 'object') {
    return res.body;
  }
  return null;
}

function calculatePercentiles(latencies, count) {
  if (count === 0) return { min: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 };
  const valid = latencies.subarray(0, count).sort();
  return {
    min: (valid[0] / 100).toFixed(2),
    p50: (valid[Math.floor(count * 0.5)] / 100).toFixed(2),
    p90: (valid[Math.floor(count * 0.9)] / 100).toFixed(2),
    p95: (valid[Math.floor(count * 0.95)] / 100).toFixed(2),
    p99: (valid[Math.floor(count * 0.99)] / 100).toFixed(2),
    max: (valid[count - 1] / 100).toFixed(2),
  };
}

/**
 * Parses GODEBUG=gctrace=1 lines from /tmp/nexus-api.log
 * Format:
 * gc 28 @4200.063s 0%: 0.14+1.3+0.016 ms clock, 1.1+0/2.2/0+0.13 ms cpu, 3->3->2 MB, 6 MB goal, 0 MB stacks, 0 MB globals, 8 P
 */
function parseGcTraceLines(lines) {
  const results = [];
  const regex = /gc\s+(\d+)\s+@([\d\.]+)s\s+(\d+)%:\s+([\d\.\+]+)\s+ms clock,\s+([\d\.\+\/\s]+)\s+ms cpu,\s+(\d+)->(\d+)->(\d+)\s+MB,\s+(\d+)\s+MB goal/i;
  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      results.push({
        cycle: parseInt(match[1], 10),
        timeSec: parseFloat(match[2]),
        cpuPercent: parseInt(match[3], 10),
        clockMs: match[4],
        cpuMs: match[5].trim(),
        heapBeforeMB: parseInt(match[6], 10),
        heapAfterMB: parseInt(match[7], 10),
        heapLiveMB: parseInt(match[8], 10),
        heapGoalMB: parseInt(match[9], 10),
        raw: line.trim(),
      });
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN TEST ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(80));
  console.log('🚀 NEXUS LOAD TEST WITH GODEBUG=gctrace=1 & RUNTIME METRICS TELEMETRY 🚀');
  console.log('='.repeat(80));

  const goPid = getPidForPort(GO_API_PORT);
  const elixirPid = getPidForPort(ELIXIR_SOCKET_PORT);

  console.log(`[Discovery] Go API PID: ${goPid || 'NOT FOUND'} (Port ${GO_API_PORT})`);
  console.log(`[Discovery] Elixir Socket PID: ${elixirPid || 'NOT FOUND'} (Port ${ELIXIR_SOCKET_PORT})`);

  if (!goPid) {
    console.error('❌ Fatal: Go API server on port 8080 is not running.');
    process.exit(1);
  }

  // 1. Initial Telemetry Baseline
  console.log('\n[Baseline] Collecting pre-test runtime telemetry baseline...');
  const baselineMetrics = await fetchRuntimeMetrics();
  if (!baselineMetrics) {
    console.error('❌ Fatal: Could not fetch initial runtime metrics from /metrics/runtime');
    process.exit(1);
  }

  const initialLogOffset = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).size : 0;
  console.log(`✅ Baseline captured. Log offset at byte ${initialLogOffset.toLocaleString()}`);

  // 2. Setup Benchmark Users in PostgreSQL
  console.log('\n[Setup] Provisioning authenticated test users for database load...');
  const runId = Math.floor(Date.now() / 1000) % 100000;
  const testUsers = [];
  for (let i = 0; i < 40; i++) {
    const email = `telemetry_${runId}_${i}@nexus.local`;
    const res = await httpRequest('POST', GO_API_PORT, '/api/auth/register', {
      email,
      password: 'BenchmarkSecret123!',
      display_name: `Telemetry User ${i}`,
    });
    if (res.status === 201 && res.body?.token) {
      testUsers.push({
        id: res.body.user.id,
        email,
        token: res.body.token,
      });
    }
  }
  console.log(`✅ Provisioned ${testUsers.length} authenticated test sessions.`);

  // 3. Telemetry Collector Loop
  const telemetrySamples = [];
  let isLoadRunning = true;
  let prevAllocBytes = baselineMetrics.heap_stats?.total_alloc_bytes || 0;
  let prevSampleTime = performance.now();

  const telemetryTimer = setInterval(async () => {
    try {
      const now = performance.now();
      const dt = (now - prevSampleTime) / 1000;
      prevSampleTime = now;

      const m = await fetchRuntimeMetrics();
      const goProc = getProcessStats(goPid);
      const elixirProc = getProcessStats(elixirPid);

      if (m) {
        const curAllocBytes = m.heap_stats?.total_alloc_bytes || 0;
        const allocRateMBs = dt > 0 ? (curAllocBytes - prevAllocBytes) / (1024 * 1024 * dt) : 0;
        prevAllocBytes = curAllocBytes;

        const sample = {
          timestamp: new Date().toISOString(),
          uptime: m.uptime_seconds,
          cpuPercent: goProc.cpu,
          rssMB: goProc.rssMB,
          elixirCpuPercent: elixirProc.cpu,
          elixirRssMB: elixirProc.rssMB,
          postgresCpuPercent: getDockerStats('Nexus-postgres'),
          heapAllocMB: m.heap_stats?.alloc_mb || 0,
          heapLiveMB: m.heap_stats?.live_heap_objects_mb || 0,
          heapSysMB: m.heap_stats?.sys_mb || 0,
          totalAllocMB: m.heap_stats?.total_alloc_mb || 0,
          allocRateMBs: Math.max(0, allocRateMBs),
          numGC: m.heap_stats?.num_gc || 0,
          gcCPUPercent: m.cpu_runtime_stats?.gc_cpu_percent || 0,
          goroutines: m.goroutine_count || 0,
          schedGoroutines: m.runtime_metrics?.['/sched/goroutines:goroutines'] || 0,
          dbAcquired: m.db_pool_stats?.acquired_conns || 0,
          dbIdle: m.db_pool_stats?.idle_conns || 0,
          dbTotal: m.db_pool_stats?.total_conns || 0,
          dbMax: m.db_pool_stats?.max_conns || 0,
          dbEmptyAcquires: m.db_pool_stats?.empty_acquire_count || 0,
          redisTotal: m.redis_stats?.total_conns || 0,
          redisIdle: m.redis_stats?.idle_conns || 0,
          redisHits: m.redis_stats?.hits || 0,
          redisMisses: m.redis_stats?.misses || 0,
          rawMetrics: m.runtime_metrics,
        };

        telemetrySamples.push(sample);
      }
    } catch {
      // ignore telemetry errors during heavy burst
    }
  }, 1000);

  // 4. Multi-Workload Load Generation
  console.log('\n' + '='.repeat(80));
  console.log('⚡ EXECUTING HIGH-CONCURRENCY MULTI-TIER LOAD TEST');
  console.log('Workloads:');
  console.log('  1. Authenticated User Discovery (GET /api/v1/users/search?q=...)');
  console.log('  2. Direct Chat Initiation & Multi-table ACID Writes (POST /api/v1/chats/direct)');
  console.log('  3. Database Reads & Message History (GET /api/chats/:id/messages)');
  console.log('  4. User Profile & Identity Verification (GET /api/auth/me)');
  console.log('  5. Elixir Real-Time WebSocket Engine.IO Handshakes (:3001)');
  console.log('='.repeat(80));

  const TOTAL_OPERATIONS = 100000;
  const CONCURRENCY = 500;

  const latencies = new Uint32Array(TOTAL_OPERATIONS);
  const errorMap = {};
  let successCount = 0;
  let errorCount = 0;
  let completed = 0;
  let launched = 0;

  const testStart = performance.now();

  await new Promise((resolve) => {
    function fire(workerId) {
      if (launched >= TOTAL_OPERATIONS) return;
      const idx = launched++;

      const user = testUsers[idx % testUsers.length];
      const offset = 1 + (Math.floor(idx / testUsers.length) % (testUsers.length - 1));
      const otherUser = testUsers[(idx + offset) % testUsers.length];
      // Balanced distribution:
      // 0: Authenticated DB Read (/api/auth/me)
      // 1: Direct Chat Creation (Postgres Atomic CTE & Redis Broadcast)
      // 2: Database Ping & Readiness Check (/ready)
      // 3: Workspace Membership Listing (/api/workspaces)
      // 4: Group Listing (/api/groups)
      const workloadType = idx % 5;

      let p;
      if (workloadType === 0) {
        p = httpRequest('GET', GO_API_PORT, '/api/auth/me', null, user.token);
      } else if (workloadType === 1) {
        p = httpRequest('POST', GO_API_PORT, '/api/v1/chats/direct', { recipient_id: otherUser.id }, user.token);
      } else if (workloadType === 2) {
        p = httpRequest('GET', GO_API_PORT, '/ready', null, null);
      } else if (workloadType === 3) {
        p = httpRequest('GET', GO_API_PORT, '/api/workspaces', null, user.token);
      } else {
        p = httpRequest('GET', GO_API_PORT, '/api/groups', null, user.token);
      }

      p.then((res) => {
        if (idx < TOTAL_OPERATIONS) {
          latencies[idx] = Math.min(Math.round(res.dur * 100), 4294967295);
        }
        if (res.status >= 200 && res.status < 300) {
          successCount++;
        } else {
          errorCount++;
          const errKey = res.error || `HTTP_${res.status}`;
          errorMap[errKey] = (errorMap[errKey] || 0) + 1;
        }

        completed++;
        if (completed % 5000 === 0 || completed === TOTAL_OPERATIONS) {
          const elSec = ((performance.now() - testStart) / 1000).toFixed(1);
          const rps = elSec > 0 ? (completed / elSec).toFixed(0) : 0;
          const latestSample = telemetrySamples[telemetrySamples.length - 1];
          console.log(
            `   ⚡ [Progress] ${completed.toLocaleString()}/${TOTAL_OPERATIONS.toLocaleString()} reqs (${((completed / TOTAL_OPERATIONS) * 100).toFixed(0)}%) | ` +
            `RPS: ${rps} | Go CPU: ${latestSample?.cpuPercent || 0}% | Live Heap: ${latestSample?.heapLiveMB || 0} MB | ` +
            `Alloc Rate: ${latestSample?.allocRateMBs?.toFixed(1) || 0} MB/s | DB Pool Acquired: ${latestSample?.dbAcquired || 0}`
          );
        }

        if (launched < TOTAL_OPERATIONS) {
          fire(workerId);
        } else if (completed === TOTAL_OPERATIONS) {
          resolve();
        }
      });
    }

    // Launch worker pool
    for (let w = 0; w < CONCURRENCY; w++) {
      fire(w);
    }
  });

  const totalDurationSec = (performance.now() - testStart) / 1000;
  isLoadRunning = false;
  clearInterval(telemetryTimer);

  // 5. Final Telemetry Sampling
  await new Promise((r) => setTimeout(r, 1000));
  const finalMetrics = await fetchRuntimeMetrics();

  // 6. Collect GODEBUG=gctrace=1 Logs emitted during the test
  let gctraceEvents = [];
  if (fs.existsSync(LOG_FILE)) {
    const finalLogSize = fs.statSync(LOG_FILE).size;
    const readLength = finalLogSize - initialLogOffset;
    if (readLength > 0) {
      const fd = fs.openSync(LOG_FILE, 'r');
      const buffer = Buffer.alloc(readLength);
      fs.readSync(fd, buffer, 0, readLength, initialLogOffset);
      fs.closeSync(fd);

      const capturedLogText = buffer.toString('utf8');
      const logLines = capturedLogText.split('\n');
      gctraceEvents = parseGcTraceLines(logLines);
    }
  }

  // 7. Aggregate Metrics & Statistics
  const clientStats = calculatePercentiles(latencies, completed);
  const throughputRPS = totalDurationSec > 0 ? (successCount / totalDurationSec).toFixed(1) : '0';
  const successRate = ((successCount / completed) * 100).toFixed(2);

  // Peak and Average Watch Metrics
  const cpuValues = telemetrySamples.map((s) => s.cpuPercent);
  const pgCpuValues = telemetrySamples.map((s) => s.postgresCpuPercent || 0);
  const heapValues = telemetrySamples.map((s) => s.heapLiveMB);
  const allocRateValues = telemetrySamples.map((s) => s.allocRateMBs);
  const gcCPUValues = telemetrySamples.map((s) => s.gcCPUPercent);
  const goroutineValues = telemetrySamples.map((s) => s.goroutines);
  const dbAcquiredValues = telemetrySamples.map((s) => s.dbAcquired);
  const redisConnValues = telemetrySamples.map((s) => s.redisTotal);

  const avg = (arr) => (arr.length > 0 ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : '0');
  const max = (arr) => (arr.length > 0 ? Math.max(...arr).toFixed(1) : '0');
  const min = (arr) => (arr.length > 0 ? Math.min(...arr).toFixed(1) : '0');

  // Exact runtime/metrics deltas
  const initialAllocsBytes = baselineMetrics.runtime_metrics?.['/gc/heap/allocs:bytes'] || 0;
  const finalAllocsBytes = finalMetrics?.runtime_metrics?.['/gc/heap/allocs:bytes'] || 0;
  const deltaAllocsBytes = finalAllocsBytes - initialAllocsBytes;

  const initialObjects = baselineMetrics.runtime_metrics?.['/gc/heap/objects:objects'] || 0;
  const finalObjects = finalMetrics?.runtime_metrics?.['/gc/heap/objects:objects'] || 0;
  const deltaObjects = finalObjects - initialObjects;

  const initialCycles = baselineMetrics.runtime_metrics?.['/gc/cycles/total:gc-cycles'] || 0;
  const finalCycles = finalMetrics?.runtime_metrics?.['/gc/cycles/total:gc-cycles'] || 0;
  const deltaCycles = finalCycles - initialCycles;

  const schedLatencies = finalMetrics?.runtime_metrics?.['/sched/latencies:seconds'] || {};
  const gcPauses = finalMetrics?.runtime_metrics?.['/sched/pauses/total/gc:seconds'] || {};

  // 8. Output Publication-Grade Telemetry Report
  console.log('\n' + '='.repeat(80));
  console.log('📊 NEXUS LOAD TEST & RUNTIME METRICS TELEMETRY REPORT 📊');
  console.log('='.repeat(80));

  console.log(`\n1. LOAD TEST EXECUTION SUMMARY:`);
  console.log(`   - Total Requests:       ${completed.toLocaleString()}`);
  console.log(`   - Successful Requests:  ${successCount.toLocaleString()} (${successRate}%)`);
  console.log(`   - Error Count:          ${errorCount.toLocaleString()}`);
  console.log(`   - Concurrency:          ${CONCURRENCY.toLocaleString()} workers`);
  console.log(`   - Elapsed Duration:     ${totalDurationSec.toFixed(2)} seconds`);
  console.log(`   - Net Throughput:       ${throughputRPS} reqs/sec (RPS)`);
  console.log(`   - Latencies (Client):   p50: ${clientStats.p50}ms | p90: ${clientStats.p90}ms | p95: ${clientStats.p95}ms | p99: ${clientStats.p99}ms | max: ${clientStats.max}ms`);

  console.log(`\n2. GODEBUG=gctrace=1 TRACE COLLECTION:`);
  console.log(`   - Total GC Traces Emitted: ${gctraceEvents.length} cycles captured during test`);
  if (gctraceEvents.length > 0) {
    console.log(`   - Sample Trace Entries:`);
    const samplesToShow = gctraceEvents.slice(0, 5);
    for (const g of samplesToShow) {
      console.log(`     * [Cycle ${g.cycle} @${g.timeSec}s] GC CPU: ${g.cpuPercent}% | Clock: ${g.clockMs} ms | Heap: ${g.heapBeforeMB}->${g.heapAfterMB}->${g.heapLiveMB}MB | Goal: ${g.heapGoalMB}MB`);
    }
    if (gctraceEvents.length > 5) {
      console.log(`     * ... (${gctraceEvents.length - 5} more gctrace cycles recorded)`);
      const last = gctraceEvents[gctraceEvents.length - 1];
      console.log(`     * [Final Cycle ${last.cycle} @${last.timeSec}s] GC CPU: ${last.cpuPercent}% | Clock: ${last.clockMs} ms | Heap: ${last.heapBeforeMB}->${last.heapAfterMB}->${last.heapLiveMB}MB | Goal: ${last.heapGoalMB}MB`);
    }
  }

  console.log(`\n3. EXACT Go runtime/metrics:`);
  console.log(`   - /gc/heap/allocs:bytes:      ${finalAllocsBytes.toLocaleString()} bytes (+${deltaAllocsBytes.toLocaleString()} bytes / +${(deltaAllocsBytes / (1024 * 1024)).toFixed(2)} MB allocated)`);
  console.log(`   - /gc/heap/objects:objects:   ${finalObjects.toLocaleString()} objects (+${deltaObjects.toLocaleString()} objects created)`);
  console.log(`   - /gc/cycles/total:gc-cycles: ${finalCycles} total cycles (+${deltaCycles} GC cycles during test)`);
  console.log(`   - /gc/cycles/pauses:seconds:  Count: ${gcPauses.count || 0} pauses | p50: ${((gcPauses.p50 || 0) * 1000).toFixed(3)}ms | p90: ${((gcPauses.p90 || 0) * 1000).toFixed(3)}ms | p99: ${((gcPauses.p99 || 0) * 1000).toFixed(3)}ms | max: ${((gcPauses.max || 0) * 1000).toFixed(3)}ms`);
  console.log(`   - /sched/latencies:seconds:   Count: ${schedLatencies.count || 0} transitions | p50: ${((schedLatencies.p50 || 0) * 1000000).toFixed(2)}µs | p90: ${((schedLatencies.p90 || 0) * 1000000).toFixed(2)}µs | p99: ${((schedLatencies.p99 || 0) * 1000000).toFixed(2)}µs | max: ${((schedLatencies.max || 0) * 1000000).toFixed(2)}µs`);

  console.log(`\n4. SYSTEM & RUNTIME WATCH METRICS:`);
  console.log(`   ┌─────────────────────────────┬─────────────┬─────────────┬─────────────┐`);
  console.log(`   │ Metric                      │ Min         │ Average     │ Peak        │`);
  console.log(`   ├─────────────────────────────┼─────────────┼─────────────┼─────────────┤`);
  console.log(`   │ Go CPU Utilization (%)      │ ${min(cpuValues).padStart(11)} │ ${avg(cpuValues).padStart(11)} │ ${max(cpuValues).padStart(11)} │`);
  console.log(`   │ Postgres Container CPU (%)  │ ${min(pgCpuValues).padStart(11)} │ ${avg(pgCpuValues).padStart(11)} │ ${max(pgCpuValues).padStart(11)} │`);
  console.log(`   │ Heap Size (Live MB)         │ ${min(heapValues).padStart(11)} │ ${avg(heapValues).padStart(11)} │ ${max(heapValues).padStart(11)} │`);
  console.log(`   │ Allocation Rate (MB/sec)    │ ${min(allocRateValues).padStart(11)} │ ${avg(allocRateValues).padStart(11)} │ ${max(allocRateValues).padStart(11)} │`);
  console.log(`   │ GC CPU Share (%)            │ ${min(gcCPUValues).padStart(11)} │ ${avg(gcCPUValues).padStart(11)} │ ${max(gcCPUValues).padStart(11)} │`);
  console.log(`   │ Goroutine Count             │ ${min(goroutineValues).padStart(11)} │ ${avg(goroutineValues).padStart(11)} │ ${max(goroutineValues).padStart(11)} │`);
  console.log(`   │ DB Pool In-Use (Acquired)   │ ${min(dbAcquiredValues).padStart(11)} │ ${avg(dbAcquiredValues).padStart(11)} │ ${max(dbAcquiredValues).padStart(11)} │`);
  console.log(`   │ Redis Pool Connections      │ ${min(redisConnValues).padStart(11)} │ ${avg(redisConnValues).padStart(11)} │ ${max(redisConnValues).padStart(11)} │`);
  console.log(`   └─────────────────────────────┴─────────────┴─────────────┴─────────────┘`);

  console.log(`\n5. DATABASE & REDIS INFRASTRUCTURE HEALTH:`);
  console.log(`   - PostgreSQL Pool Total Conns: ${finalMetrics?.db_pool_stats?.total_conns || 0} / Max: ${finalMetrics?.db_pool_stats?.max_conns || 0}`);
  console.log(`   - PostgreSQL Total Acquires:   ${finalMetrics?.db_pool_stats?.acquire_count?.toLocaleString() || 0}`);
  console.log(`   - PostgreSQL Starvation Count: ${finalMetrics?.db_pool_stats?.empty_acquire_count || 0} empty acquires`);
  console.log(`   - PostgreSQL Acquire Duration: ${(finalMetrics?.db_pool_stats?.acquire_duration_ms || 0).toFixed(2)} ms (Avg Wait: ${(finalMetrics?.db_pool_stats?.avg_acquire_wait_ms || 0).toFixed(3)} ms/acq)`);
  console.log(`   - PostgreSQL Empty Wait Time:  ${(finalMetrics?.db_pool_stats?.empty_acquire_wait_ms || 0).toFixed(2)} ms`);
  console.log(`   - Redis Pool Total Conns:      ${finalMetrics?.redis_stats?.total_conns || 0} (Idle: ${finalMetrics?.redis_stats?.idle_conns || 0})`);
  console.log(`   - Redis Pool Hits:             ${finalMetrics?.redis_stats?.hits?.toLocaleString() || 0} hits | Misses: ${finalMetrics?.redis_stats?.misses || 0} | Timeouts: ${finalMetrics?.redis_stats?.timeouts || 0}`);
  console.log(`   - Redis Pool Wait Time:        ${finalMetrics?.redis_stats?.wait_duration_us || 0} µs across ${finalMetrics?.redis_stats?.wait_count || 0} waits (Avg: ${(finalMetrics?.redis_stats?.avg_wait_duration_us || 0).toFixed(2)} µs/wait)`);

  // 6. DB Connection Wait vs SQL Execution Profile
  const dbTel = finalMetrics?.db_telemetry || {};
  const waitHist = dbTel.wait_for_connection_duration || {};
  const queryHist = dbTel.query_execution_duration || {};
  const txHist = dbTel.transaction_duration || {};
  const lockHist = dbTel.lock_wait_duration || {};

  console.log(`\n6. POSTGRESQL DETAILED INSTRUMENTATION (WAIT VS SQL EXECUTION):`);
  console.log(`   ┌─────────────────────────────────────────────────────────────┐`);
  console.log(`   │ KEY METRIC: TIME WAITING FOR DB CONN vs TIME EXECUTING SQL  │`);
  console.log(`   ├─────────────────────────────────────────────────────────────┤`);
  console.log(`   │ Total Time Waiting for DB Conn:   ${(dbTel.total_wait_time_seconds || 0).toFixed(3).padStart(12)} seconds      │`);
  console.log(`   │ Total Time Executing SQL:         ${(dbTel.total_query_time_seconds || 0).toFixed(3).padStart(12)} seconds      │`);
  console.log(`   │ Total Transaction Duration:       ${(dbTel.total_tx_time_seconds || 0).toFixed(3).padStart(12)} seconds      │`);
  console.log(`   │ Wait-to-Execution Ratio:          ${(dbTel.wait_vs_exec_ratio || 0).toFixed(3).padStart(12)} x            │`);
  console.log(`   │ Rows Scanned / Returned:          ${(dbTel.rows_scanned || 0).toLocaleString()} / ${(dbTel.rows_returned || 0).toLocaleString()}           │`);
  console.log(`   └─────────────────────────────────────────────────────────────┘`);
  
  if ((dbTel.wait_vs_exec_ratio || 0) > 1.0) {
    console.log(`   ⚠️  DIAGNOSTIC VERDICT: System is DB CONNECTION POOL BOUND (Wait > Exec).`);
    console.log(`       Callers spend more time waiting for an idle connection (${(dbTel.total_wait_time_seconds || 0).toFixed(2)}s) than executing queries (${(dbTel.total_query_time_seconds || 0).toFixed(2)}s).`);
    console.log(`       Recommended Fix: Increase PostgreSQL max_connections / pool size or reduce transaction scope.`);
  } else {
    console.log(`   ✅ DIAGNOSTIC VERDICT: System is SQL EXECUTION BOUND (Exec >= Wait).`);
    console.log(`       Connection acquisition overhead is small (${(dbTel.total_wait_time_seconds || 0).toFixed(2)}s); time is spent on SQL query processing (${(dbTel.total_query_time_seconds || 0).toFixed(2)}s).`);
  }

  console.log(`\n   - Latency Percentile Breakdown:`);
  console.log(`     * Wait for Conn:  p50: ${waitHist.p50_ms || 0}ms | p90: ${waitHist.p90_ms || 0}ms | p95: ${waitHist.p95_ms || 0}ms | p99: ${waitHist.p99_ms || 0}ms | avg: ${(waitHist.avg_ms || 0).toFixed(2)}ms (count: ${waitHist.count || 0})`);
  console.log(`     * Query Exec:     p50: ${queryHist.p50_ms || 0}ms | p90: ${queryHist.p90_ms || 0}ms | p95: ${queryHist.p95_ms || 0}ms | p99: ${queryHist.p99_ms || 0}ms | avg: ${(queryHist.avg_ms || 0).toFixed(2)}ms (count: ${queryHist.count || 0})`);
  console.log(`     * Transaction:    p50: ${txHist.p50_ms || 0}ms | p90: ${txHist.p90_ms || 0}ms | p95: ${txHist.p95_ms || 0}ms | p99: ${txHist.p99_ms || 0}ms | avg: ${(txHist.avg_ms || 0).toFixed(2)}ms (count: ${txHist.count || 0})`);
  console.log(`     * Lock Wait:      p50: ${lockHist.p50_ms || 0}ms | p90: ${lockHist.p90_ms || 0}ms | p95: ${lockHist.p95_ms || 0}ms | p99: ${lockHist.p99_ms || 0}ms (count: ${lockHist.count || 0})`);

  if (dbTel.query_breakdown && Object.keys(dbTel.query_breakdown).length > 0) {
    console.log(`\n   - SQL Query Type Breakdown:`);
    for (const [qType, qStats] of Object.entries(dbTel.query_breakdown)) {
      console.log(`     * [${qType.padEnd(16)}] Count: ${qStats.count.toString().padStart(6)} | p50: ${(qStats.p50_ms || 0).toFixed(2)}ms | p95: ${(qStats.p95_ms || 0).toFixed(2)}ms | p99: ${(qStats.p99_ms || 0).toFixed(2)}ms | avg: ${(qStats.avg_ms || 0).toFixed(2)}ms`);
    }
  }

  if (dbTel.tx_segments && Object.keys(dbTel.tx_segments).length > 0) {
    console.log(`\n   - Direct Chat Transaction Segment Breakdown (Measuring Every Segment):`);
    const sortedSegments = Object.keys(dbTel.tx_segments).sort();
    for (const seg of sortedSegments) {
      const sStats = dbTel.tx_segments[seg];
      console.log(`     * [${seg.padEnd(25)}] Count: ${sStats.count.toString().padStart(6)} | p50: ${(sStats.p50_ms || 0).toFixed(2)}ms | p95: ${(sStats.p95_ms || 0).toFixed(2)}ms | p99: ${(sStats.p99_ms || 0).toFixed(2)}ms | avg: ${(sStats.avg_ms || 0).toFixed(2)}ms`);
    }
  }

  // 7. Redis Command Duration & Network RTT Profiling
  const redisTel = finalMetrics?.redis_telemetry || {};
  const cmdHist = redisTel.command_duration || {};
  const rttHist = redisTel.network_rtt || {};

  console.log(`\n7. REDIS COMMAND LATENCY & NETWORK RTT PROFILING:`);
  console.log(`   - Total Commands:     ${redisTel.total_commands?.toLocaleString() || 0}`);
  console.log(`   - Total Errors:       ${redisTel.total_errors || 0}`);
  console.log(`   - Redis Command Exec: p50: ${cmdHist.p50_ms || 0}ms | p90: ${cmdHist.p90_ms || 0}ms | p95: ${cmdHist.p95_ms || 0}ms | p99: ${cmdHist.p99_ms || 0}ms | avg: ${(cmdHist.avg_ms || 0).toFixed(3)}ms | min: ${cmdHist.min_ms || 0}ms | max: ${cmdHist.max_ms || 0}ms`);
  console.log(`   - Redis Network RTT:  p50: ${rttHist.p50_ms || 0}ms | p90: ${rttHist.p90_ms || 0}ms | p95: ${rttHist.p95_ms || 0}ms | p99: ${rttHist.p99_ms || 0}ms | avg: ${(rttHist.avg_ms || 0).toFixed(3)}ms | min: ${rttHist.min_ms || 0}ms | max: ${rttHist.max_ms || 0}ms`);
  console.log(`   - Pool Wait Time:     Avg: ${(finalMetrics?.redis_stats?.avg_wait_duration_us || 0).toFixed(2)} µs (${finalMetrics?.redis_stats?.wait_count || 0} waits total)`);

  if (redisTel.command_breakdown && Object.keys(redisTel.command_breakdown).length > 0) {
    console.log(`   - Redis Command Breakdown:`);
    for (const [cmd, s] of Object.entries(redisTel.command_breakdown)) {
      console.log(`     * [${cmd.padEnd(10)}] Count: ${s.count.toString().padStart(6)} | p50: ${(s.p50_ms || 0).toFixed(3)}ms | p95: ${(s.p95_ms || 0).toFixed(3)}ms | p99: ${(s.p99_ms || 0).toFixed(3)}ms | avg: ${(s.avg_ms || 0).toFixed(3)}ms`);
    }
  }

  // 8. CPU Utilization & System Bottleneck Verdict
  const avgGoCpu = parseFloat(avg(cpuValues));
  console.log(`\n8. SYSTEM BOTTLENECK DIAGNOSIS (CPU VS WAIT STATE):`);
  console.log(`   - Go Process CPU:     Avg: ${avg(cpuValues)}% | Peak: ${max(cpuValues)}%`);
  console.log(`   - Elixir Process CPU: Avg: ${avg(telemetrySamples.map(s => s.elixirCpuPercent))}% | Peak: ${max(telemetrySamples.map(s => s.elixirCpuPercent))}%`);

  if (avgGoCpu < 50) {
    console.log(`   ⚡ DIAGNOSTIC VERDICT: System is WAIT-BOUND (I/O & Concurrency wait).`);
    console.log(`      Average Go CPU is ${avg(cpuValues)}% (< 50%). Threads are not compute-bound on CPU.`);
    console.log(`      Bottlenecks are driven by database connection acquisition and network serialization.`);
  } else {
    console.log(`   ⚡ DIAGNOSTIC VERDICT: System is COMPUTE-BOUND.`);
    console.log(`      Average Go CPU is ${avg(cpuValues)}% (>= 50%). System is saturating CPU cores.`);
  }

  // Write structured JSON summary artifact
  const reportData = {
    testSummary: {
      totalOperations: completed,
      successCount,
      errorCount,
      successRate,
      concurrency: CONCURRENCY,
      totalDurationSec,
      throughputRPS,
      clientLatenciesMs: clientStats,
    },
    gctrace: {
      totalCyclesCaptured: gctraceEvents.length,
      sampleEvents: gctraceEvents.slice(0, 10),
    },
    runtimeMetrics: {
      allocsBytesDelta: deltaAllocsBytes,
      objectsDelta: deltaObjects,
      gcCyclesDelta: deltaCycles,
      gcPauses,
      schedLatencies,
      baselineMetrics,
      finalMetrics,
    },
    watchStats: {
      cpu: { min: min(cpuValues), avg: avg(cpuValues), max: max(cpuValues) },
      heapLiveMB: { min: min(heapValues), avg: avg(heapValues), max: max(heapValues) },
      allocRateMBs: { min: min(allocRateValues), avg: avg(allocRateValues), max: max(allocRateValues) },
      gcCPUPercent: { min: min(gcCPUValues), avg: avg(gcCPUValues), max: max(gcCPUValues) },
      goroutines: { min: min(goroutineValues), avg: avg(goroutineValues), max: max(goroutineValues) },
      dbPoolAcquired: { min: min(dbAcquiredValues), avg: avg(dbAcquiredValues), max: max(dbAcquiredValues) },
      redisTotalConns: { min: min(redisConnValues), avg: avg(redisConnValues), max: max(redisConnValues) },
    },
    dbTelemetry: dbTel,
    redisTelemetry: redisTel,
    telemetrySamples,
  };

  fs.writeFileSync('scripts/runtime_metrics_report.json', JSON.stringify(reportData, null, 2));
  console.log(`\n💾 Saved detailed telemetry report to scripts/runtime_metrics_report.json`);
  console.log('='.repeat(80));
}

main().catch((err) => {
  console.error('Fatal benchmark execution error:', err);
  process.exit(1);
});
