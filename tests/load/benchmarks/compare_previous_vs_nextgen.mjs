#!/usr/bin/env node
/**
 * Head-to-Head Architectural Benchmark: Previous Services vs. Next-Gen Services
 * 
 * Matchup 1: Real-Time Socket Service
 * - Legacy:   Node.js Socket.IO (services/nexus-socket on :3002)
 * - Next-Gen: Elixir / Phoenix Channels Bandit (nexus-socket on :3001)
 * 
 * Matchup 2: Core REST API
 * - Legacy:   Go Monolithic Handlers (services/nexus-api on :8081)
 * - Next-Gen: Go Modular Clean Architecture (nexus-api on :8080)
 */

import http from 'node:http';
import { execSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const NODE_SOCKET_PORT = 3002;
const ELIXIR_SOCKET_PORT = 3001;
const LEGACY_API_PORT = 8081;
const MODULAR_API_PORT = 8080;

function getProcessMemoryMB(pid) {
  try {
    const out = execSync(`ps -o rss= -p ${pid}`, { encoding: 'utf8' }).trim();
    const rssKB = parseInt(out, 10);
    return isNaN(rssKB) ? 0 : (rssKB / 1024).toFixed(1);
  } catch {
    return '0.0';
  }
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

function calculatePercentiles(latencies, count) {
  if (count === 0) return { p50: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0 };
  const valid = latencies.subarray(0, count).sort();
  return {
    min: valid[0] / 100,
    p50: valid[Math.floor(count * 0.5)] / 100,
    p90: valid[Math.floor(count * 0.9)] / 100,
    p95: valid[Math.floor(count * 0.95)] / 100,
    p99: valid[Math.floor(count * 0.99)] / 100,
    max: valid[count - 1] / 100,
  };
}

function runBenchmark(title, port, path, workers, requests, pid) {
  const agent = new http.Agent({
    keepAlive: true,
    maxSockets: workers + 500,
    keepAliveMsecs: 120000,
  });

  const latencies = new Uint32Array(requests);
  const errorMap = {};
  let successCount = 0;
  let errorCount = 0;
  let completed = 0;
  let launched = 0;

  const memBefore = pid ? getProcessMemoryMB(pid) : 'N/A';
  const start = performance.now();

  console.log(`\n   ⚡ Testing ${title} on port ${port}...`);
  console.log(`      Workers: ${workers.toLocaleString()} | Requests: ${requests.toLocaleString()} | Start RSS: ${memBefore} MB`);

  return new Promise((resolve) => {
    function fire(wId) {
      if (launched >= requests) return;
      const curIdx = launched++;

      const reqStart = performance.now();
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method: 'GET',
          agent,
          headers: { Connection: 'keep-alive', Accept: '*/*' },
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => {
            const dur = performance.now() - reqStart;
            if (curIdx < requests) latencies[curIdx] = Math.min(Math.round(dur * 100), 4294967295);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              successCount++;
            } else {
              errorCount++;
              const code = `HTTP_${res.statusCode}`;
              errorMap[code] = (errorMap[code] || 0) + 1;
            }
            completed++;
            if (launched < requests) fire(wId);
            else if (completed === requests) finish();
          });
        }
      );

      req.on('error', (err) => {
        const dur = performance.now() - reqStart;
        if (curIdx < requests) latencies[curIdx] = Math.min(Math.round(dur * 100), 4294967295);
        errorCount++;
        const code = err.code || err.message || 'ERR';
        errorMap[code] = (errorMap[code] || 0) + 1;
        completed++;
        if (launched < requests) fire(wId);
        else if (completed === requests) finish();
      });

      req.end();
    }

    // Micro-stagger launch
    const batchSize = Math.min(500, workers);
    let launchedWorkers = 0;
    const timer = setInterval(() => {
      const end = Math.min(launchedWorkers + batchSize, workers, requests);
      for (; launchedWorkers < end; launchedWorkers++) {
        fire(launchedWorkers);
      }
      if (launchedWorkers >= workers || launchedWorkers >= requests) {
        clearInterval(timer);
      }
    }, 10);

    const logInterval = setInterval(() => {
      if (completed < requests) {
        const elapsed = ((performance.now() - start) / 1000).toFixed(1);
        const pct = ((completed / requests) * 100).toFixed(1);
        const currRps = elapsed > 0 ? (completed / elapsed).toFixed(0) : 0;
        process.stdout.write(`\r      ⏳ Progress: ${completed.toLocaleString()}/${requests.toLocaleString()} (${pct}%) in ${elapsed}s (~${currRps} RPS)`);
      }
    }, 2000);

    function finish() {
      clearInterval(logInterval);
      process.stdout.write('\r' + ' '.repeat(70) + '\r');
      const durationSec = (performance.now() - start) / 1000;
      agent.destroy();

      const memAfter = pid ? getProcessMemoryMB(pid) : 'N/A';
      const stats = calculatePercentiles(latencies, completed);
      const rps = durationSec > 0 ? successCount / durationSec : 0;
      const successRate = (successCount / (completed || 1)) * 100;

      console.log(`      ✅ Completed in ${durationSec.toFixed(2)}s | Throughput: ${rps.toFixed(1)} RPS | Success: ${successRate.toFixed(2)}%`);
      console.log(`         Latency: p50=${stats.p50.toFixed(2)}ms | p90=${stats.p90.toFixed(2)}ms | p99=${stats.p99.toFixed(2)}ms | Max=${stats.max.toFixed(2)}ms`);
      console.log(`         Memory RSS: ${memBefore} MB -> ${memAfter} MB (Δ: ${memBefore !== 'N/A' && memAfter !== 'N/A' ? (parseFloat(memAfter) - parseFloat(memBefore)).toFixed(1) : 'N/A'} MB)`);
      if (errorCount > 0) {
        console.log(`         ⚠️ Errors (${errorCount}):`, JSON.stringify(errorMap));
      }

      resolve({
        title,
        port,
        workers,
        requests,
        durationSec,
        rps,
        stats,
        successRate,
        errorCount,
        memBefore,
        memAfter,
      });
    }
  });
}

async function main() {
  console.log('='.repeat(80));
  console.log('⚔️  HEAD-TO-HEAD BENCHMARK: PREVIOUS SERVICES VS. NEXT-GEN SERVICES ⚔️');
  console.log('='.repeat(80));

  const nodePid = getPidForPort(NODE_SOCKET_PORT);
  const elixirPid = getPidForPort(ELIXIR_SOCKET_PORT);
  const legacyApiPid = getPidForPort(LEGACY_API_PORT);
  const modularApiPid = getPidForPort(MODULAR_API_PORT);

  console.log('Target Service PIDs & Ports:');
  console.log(`  1. Legacy Socket Service (Node.js):   PID ${nodePid || 'NOT FOUND'} on port ${NODE_SOCKET_PORT}`);
  console.log(`  2. Next-Gen Socket Gateway (Elixir):  PID ${elixirPid || 'NOT FOUND'} on port ${ELIXIR_SOCKET_PORT}`);
  console.log(`  3. Legacy API Service (Go Monolith):  PID ${legacyApiPid || 'NOT FOUND'} on port ${LEGACY_API_PORT}`);
  console.log(`  4. Next-Gen API Service (Go Modular): PID ${modularApiPid || 'NOT FOUND'} on port ${MODULAR_API_PORT}`);
  console.log('='.repeat(80));

  if (!nodePid || !elixirPid) {
    console.error('Fatal: Required socket services are not running. Please verify ports 3001 and 3002.');
    process.exit(1);
  }

  // =========================================================================
  // MATCHUP 1: REAL-TIME SOCKET GATEWAY (Node.js vs. Elixir)
  // =========================================================================
  console.log('\n' + '█'.repeat(80));
  console.log('🏆 MATCHUP 1: REAL-TIME SOCKET SERVICE (Node.js vs. Elixir BEAM)');
  console.log('█'.repeat(80));

  const socketTiers = [
    { name: 'Tier 1: Moderate Concurrency', workers: 5000, requests: 50000 },
    { name: 'Tier 2: High Concurrency', workers: 15000, requests: 150000 },
    { name: 'Tier 3: Extreme Concurrency', workers: 30000, requests: 300000 },
  ];

  const socketResults = [];

  for (const tier of socketTiers) {
    console.log(`\n--- ${tier.name} (${tier.workers.toLocaleString()} Workers, ${tier.requests.toLocaleString()} Requests) ---`);

    // Test Legacy Node.js
    const nodeRes = await runBenchmark('Legacy Node.js Socket', NODE_SOCKET_PORT, '/health', tier.workers, tier.requests, nodePid);
    await new Promise((r) => setTimeout(r, 2000));

    // Test Next-Gen Elixir
    const elixirRes = await runBenchmark('Next-Gen Elixir Gateway', ELIXIR_SOCKET_PORT, '/health', tier.workers, tier.requests, elixirPid);
    await new Promise((r) => setTimeout(r, 2000));

    const speedup = (elixirRes.rps / (nodeRes.rps || 1)).toFixed(2);
    const p99Reduction = (((nodeRes.stats.p99 - elixirRes.stats.p99) / (nodeRes.stats.p99 || 1)) * 100).toFixed(1);

    console.log(`\n   📊 ${tier.name} Head-to-Head:`);
    console.log(`      🚀 Throughput: Elixir is ${speedup}x FASTER (${elixirRes.rps.toFixed(0)} RPS vs. ${nodeRes.rps.toFixed(0)} RPS)`);
    console.log(`      ⏱️  Tail Latency: Elixir p99 is ${p99Reduction}% LOWER (${elixirRes.stats.p99.toFixed(2)}ms vs. ${nodeRes.stats.p99.toFixed(2)}ms)`);

    socketResults.push({ tier: tier.name, nodeRes, elixirRes, speedup, p99Reduction });
  }

  // =========================================================================
  // MATCHUP 2: REST API ARCHITECTURE (Legacy Go Monolith vs. Modular Go API)
  // =========================================================================
  console.log('\n\n' + '█'.repeat(80));
  console.log('🏆 MATCHUP 2: REST API ARCHITECTURE (Legacy Monolith vs. Next-Gen Modular API)');
  console.log('█'.repeat(80));

  const apiTests = [
    { name: 'REST Health Probe', path: '/health', workers: 15000, requests: 150000 },
    { name: 'Postgres pgxpool Ping (/ready)', path: '/ready', workers: 1000, requests: 15000 },
  ];

  const apiResults = [];

  for (const t of apiTests) {
    console.log(`\n--- ${t.name} (${t.workers.toLocaleString()} Workers, ${t.requests.toLocaleString()} Requests) ---`);

    const legRes = await runBenchmark('Legacy Go Monolith (:8081)', LEGACY_API_PORT, t.path, t.workers, t.requests, legacyApiPid);
    await new Promise((r) => setTimeout(r, 2000));

    const modRes = await runBenchmark('Next-Gen Modular API (:8080)', MODULAR_API_PORT, t.path, t.workers, t.requests, modularApiPid);
    await new Promise((r) => setTimeout(r, 2000));

    apiResults.push({ test: t.name, legRes, modRes });
  }

  // =========================================================================
  // FINAL GRAND SCORECARD
  // =========================================================================
  console.log('\n\n' + '='.repeat(80));
  console.log('📋 GRAND ARCHITECTURAL COMPARISON SCORECARD');
  console.log('='.repeat(80));

  console.log('\n1. REAL-TIME SOCKETS: Node.js vs. Elixir');
  console.log(
    `${'Tier'.padEnd(28)} | ${'Node.js RPS'.padEnd(12)} | ${'Elixir RPS'.padEnd(12)} | ${'Speedup'.padEnd(10)} | ${'Node p99'.padEnd(10)} | ${'Elixir p99'}`
  );
  console.log('-'.repeat(80));
  for (const r of socketResults) {
    console.log(
      `${r.tier.padEnd(28)} | ` +
      `${r.nodeRes.rps.toFixed(0).padEnd(12)} | ` +
      `${r.elixirRes.rps.toFixed(0).padEnd(12)} | ` +
      `${(r.speedup + 'x').padEnd(10)} | ` +
      `${(r.nodeRes.stats.p99.toFixed(1) + 'ms').padEnd(10)} | ` +
      `${r.elixirRes.stats.p99.toFixed(1)}ms`
    );
  }

  console.log('\n2. REST API: Legacy Go Monolith (:8081) vs. Next-Gen Modular Go API (:8080)');
  console.log(
    `${'Test'.padEnd(30)} | ${'Legacy RPS'.padEnd(13)} | ${'Modular RPS'.padEnd(13)} | ${'Legacy p50'.padEnd(12)} | ${'Modular p50'}`
  );
  console.log('-'.repeat(80));
  for (const r of apiResults) {
    console.log(
      `${r.test.padEnd(30)} | ` +
      `${r.legRes.rps.toFixed(0).padEnd(13)} | ` +
      `${r.modRes.rps.toFixed(0).padEnd(13)} | ` +
      `${(r.legRes.stats.p50.toFixed(2) + 'ms').padEnd(12)} | ` +
      `${r.modRes.stats.p50.toFixed(2)}ms`
    );
  }

  console.log('='.repeat(80));
  console.log('🏁 ARCHITECTURAL EVALUATION COMPLETED SUCCESSFULLY!');
}

main().catch(console.error);
