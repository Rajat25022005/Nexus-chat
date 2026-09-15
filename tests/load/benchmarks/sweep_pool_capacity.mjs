#!/usr/bin/env node
/**
 * ==============================================================================
 * NEXUS CONNECTION POOL CAPACITY SWEEP (80 -> 100 -> 120 -> 160)
 * ==============================================================================
 * Tests whether increasing PostgreSQL pool size actually increases throughput
 * or merely moves the bottleneck into PostgreSQL engine contention.
 * ==============================================================================
 */

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';

const POOL_SIZES = [80, 100, 120, 160];
const GO_PORT = 8080;

function waitForReady(maxAttempts = 30) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      const req = http.get(`http://127.0.0.1:${GO_PORT}/ready`, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else if (attempts >= maxAttempts) {
          reject(new Error(`Server not ready after ${attempts} attempts`));
        } else {
          setTimeout(check, 500);
        }
      });
      req.on('error', () => {
        if (attempts >= maxAttempts) {
          reject(new Error(`Server connection failed after ${attempts} attempts`));
        } else {
          setTimeout(check, 500);
        }
      });
    };
    check();
  });
}

function killApi() {
  try {
    execSync('pkill -9 -f nexus-api/bin/nexus-api || true');
  } catch {}
  try {
    execSync(`lsof -ti tcp:${GO_PORT} -sTCP:LISTEN | xargs kill -9 2>/dev/null || true`);
  } catch {}
  try {
    execSync('rm -f /tmp/nexus-api.log');
  } catch {}
}

async function startApi(poolSize) {
  killApi();
  await new Promise((r) => setTimeout(r, 1000));

  const env = {
    ...process.env,
    ENV: 'production',
    GIN_MODE: 'release',
    DATABASE_URL: 'postgres://NEXUS:MALIK@127.0.0.1:5432/nexus?sslmode=disable',
    REDIS_URL: 'redis://127.0.0.1:6379',
    PORT: String(GO_PORT),
    DB_MAX_CONNS: String(poolSize),
    GODEBUG: 'gctrace=1',
  };

  const outFd = fs.openSync('/tmp/nexus-api.log', 'a');
  const child = spawn('/Users/rajat/Desktop/Nexus-chat/nexus-api/bin/nexus-api', [], {
    env,
    cwd: '/Users/rajat/Desktop/Nexus-chat/nexus-api',
    detached: true,
    stdio: ['ignore', outFd, outFd],
  });
  child.unref();

  await waitForReady();
}

async function main() {
  console.log('='.repeat(80));
  console.log('🔬 POSTGRESQL CONNECTION POOL CAPACITY SWEEP BENCHMARK (80 -> 100 -> 120 -> 160)');
  console.log('='.repeat(80));

  let sweepResults = [];
  const reportPath = 'scripts/pool_sweep_report.json';
  if (fs.existsSync(reportPath)) {
    try {
      sweepResults = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      console.log(`📋 Found ${sweepResults.length} existing pool sweep results.`);
    } catch {}
  }

  for (const size of POOL_SIZES) {
    const existing = sweepResults.find((r) => r.poolSize === size);
    if (existing) {
      console.log(`\n>>> [SWEEP STEP] Pool Size: ${size} connections already benchmarked (RPS: ${existing.rps}). Skipping.`);
      continue;
    }

    console.log(`\n>>> [SWEEP STEP] Testing Pool Size: ${size} connections...`);
    await startApi(size);
    console.log(`✅ nexus-api running with DB_MAX_CONNS=${size}. Starting 100k load test...`);

    // Run the benchmark
    try {
      execSync('node scripts/runtime_metrics_load_test.mjs', { stdio: 'inherit' });
    } catch (err) {
      console.error(`Benchmark failed at pool size ${size}:`, err.message);
    }

    // Read report
    if (fs.existsSync('scripts/runtime_metrics_report.json')) {
      const report = JSON.parse(fs.readFileSync('scripts/runtime_metrics_report.json', 'utf8'));
      const samples = report.telemetrySamples || [];
      const pgCpus = samples.map((s) => s.postgresCpuPercent || 0);
      const avgPgCpu = pgCpus.length > 0 ? (pgCpus.reduce((a, b) => a + b, 0) / pgCpus.length).toFixed(1) : '0';
      const peakPgCpu = pgCpus.length > 0 ? Math.max(...pgCpus).toFixed(1) : '0';

      sweepResults.push({
        poolSize: size,
        rps: parseFloat(report.testSummary.throughputRPS),
        clientP95: parseFloat(report.testSummary.clientLatenciesMs.p95),
        clientP99: parseFloat(report.testSummary.clientLatenciesMs.p99),
        totalWaitSec: report.dbTelemetry?.total_wait_time_seconds || 0,
        avgWaitMs: report.runtimeMetrics?.finalMetrics?.db_pool_stats?.avg_acquire_wait_ms || 0,
        emptyAcquires: report.runtimeMetrics?.finalMetrics?.db_pool_stats?.empty_acquire_count || 0,
        sqlP99: report.dbTelemetry?.query_execution_duration?.p99_ms || 0,
        txP99: report.dbTelemetry?.transaction_duration?.p99_ms || 0,
        goCpuAvg: report.watchStats?.cpu?.avg || 0,
        pgCpuAvg: avgPgCpu,
        pgCpuPeak: peakPgCpu,
      });

      // Incremental save
      fs.writeFileSync(reportPath, JSON.stringify(sweepResults, null, 2));
      console.log(`💾 Persisted step ${size} conns to ${reportPath}`);
    }
  }

  // Print Comparative Results Table
  console.log('\n' + '='.repeat(105));
  console.log('📊 POSTGRESQL POOL CAPACITY SWEEP COMPARISON TABLE (80 -> 100 -> 120 -> 160)');
  console.log('='.repeat(105));
  console.log('┌──────────┬──────────┬──────────┬──────────┬──────────────┬──────────────┬──────────┬──────────┬──────────┬──────────┐');
  console.log('│ Pool Size│ Net RPS  │ Client p95│ Client p99│ DB Wait Sec  │ Avg Wait/Acq │ SQL p99  │ Tx p99   │ Go CPU % │ Postgres%│');
  console.log('├──────────┼──────────┼──────────┼──────────┼──────────────┼──────────────┼──────────┼──────────┼──────────┼──────────┤');

  for (const r of sweepResults) {
    const pSize = `${r.poolSize} conns`.padStart(9);
    const rps = r.rps.toFixed(1).padStart(9);
    const p95 = `${r.clientP95.toFixed(1)}ms`.padStart(9);
    const p99 = `${r.clientP99.toFixed(1)}ms`.padStart(9);
    const waitSec = `${r.totalWaitSec.toFixed(1)}s`.padStart(13);
    const avgWait = `${r.avgWaitMs.toFixed(2)}ms`.padStart(13);
    const sqlP99 = `${r.sqlP99}ms`.padStart(9);
    const txP99 = `${r.txP99}ms`.padStart(9);
    const goCpu = `${r.goCpuAvg}%`.padStart(9);
    const pgCpu = `${r.pgCpuAvg}%`.padStart(9);

    console.log(`│${pSize} │${rps} │${p95} │${p99} │${waitSec} │${avgWait} │${sqlP99} │${txP99} │${goCpu} │${pgCpu} │`);
  }
  console.log('└──────────┴──────────┴──────────┴──────────┴──────────────┴──────────────┴──────────┴──────────┴──────────┴──────────┘');

  // Save sweep summary to json
  fs.writeFileSync('scripts/pool_sweep_report.json', JSON.stringify(sweepResults, null, 2));
  console.log('\n💾 Saved sweep comparison to scripts/pool_sweep_report.json');
  console.log('='.repeat(105));
}

main().catch((err) => {
  console.error('Sweep execution error:', err);
  process.exit(1);
});
