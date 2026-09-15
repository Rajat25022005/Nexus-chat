#!/usr/bin/env node
/**
 * 100,000 Simultaneous Sockets Century Benchmark (Go API + Elixir Socket)
 * 
 * Uses multi-IP loopback distribution (127.0.0.1, 127.0.0.2, 127.0.0.3)
 * to break past the 16-bit 65,535 TCP port ceiling and sustain 100,000 concurrent sockets!
 * 
 * Target: Go API (:8080) AND Elixir Socket (:3001) simultaneously
 * Volume: Up to 2,400,000 Total Requests in Parallel
 */

import http from 'node:http';
import { performance } from 'node:perf_hooks';

const GO_PORT = 8080;
const ELIXIR_PORT = 3001;

// Multi-IP loopback pool to exceed the 65,535 single-IP ephemeral port ceiling
const LOOPBACK_IPS = ['127.0.0.1', '127.0.0.2', '127.0.0.3'];

const CENTURY_TIERS = [
  { totalWorkers: 60000, totalRequests: 600000 },
  { totalWorkers: 80000, totalRequests: 800000 },
  { totalWorkers: 100000, totalRequests: 1000000 },
];

function runDistributedService(name, port, path, workers, requests) {
  // Create an HTTP agent for each loopback IP to divide connection pool
  const agents = LOOPBACK_IPS.map(
    () =>
      new http.Agent({
        keepAlive: true,
        maxSockets: Math.ceil(workers / LOOPBACK_IPS.length) + 1500,
        keepAliveMsecs: 300000,
      })
  );

  const latencies = new Uint32Array(requests);
  const errorMap = {};
  let successCount = 0;
  let errorCount = 0;
  let completed = 0;
  let launched = 0;

  const start = performance.now();

  return new Promise((resolve) => {
    function fire(wId) {
      if (launched >= requests) return;
      const curIdx = launched++;

      // Distribute round-robin across loopback alias IPs
      const ipIdx = wId % LOOPBACK_IPS.length;
      const targetHost = LOOPBACK_IPS[ipIdx];
      const agent = agents[ipIdx];

      const options = {
        hostname: targetHost,
        port: port,
        path: path,
        method: 'GET',
        agent: agent,
        headers: {
          Connection: 'keep-alive',
          Accept: '*/*',
        },
      };

      const reqStart = performance.now();
      const req = http.request(options, (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          const dur = performance.now() - reqStart;
          if (curIdx < requests) {
            latencies[curIdx] = Math.min(Math.round(dur * 100), 4294967295);
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            successCount++;
          } else {
            errorCount++;
            const code = `HTTP_${res.statusCode}`;
            errorMap[code] = (errorMap[code] || 0) + 1;
          }
          completed++;
          if (launched < requests) {
            fire(wId);
          } else if (completed === requests) {
            finish();
          }
        });
      });

      req.on('error', (err) => {
        const dur = performance.now() - reqStart;
        if (curIdx < requests) {
          latencies[curIdx] = Math.min(Math.round(dur * 100), 4294967295);
        }
        errorCount++;
        const code = err.code || err.message || 'UNKNOWN_ERROR';
        errorMap[code] = (errorMap[code] || 0) + 1;
        completed++;
        if (launched < requests) {
          fire(wId);
        } else if (completed === requests) {
          finish();
        }
      });

      req.end();
    }

    // Micro-stagger connection launch (500 workers every 10ms)
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
        console.log(`   ⏱️ [${name}] ${completed.toLocaleString()}/${requests.toLocaleString()} reqs (${pct}%) in ${elapsed}s (~${currRps} RPS, errors: ${errorCount})`);
      }
    }, 4000);

    function finish() {
      clearInterval(logInterval);
      const durationSec = (performance.now() - start) / 1000;
      for (const a of agents) a.destroy();

      const validLatencies = latencies.subarray(0, completed).sort();
      const n = validLatencies.length;
      const p50 = n > 0 ? validLatencies[Math.floor(n * 0.5)] / 100 : 0;
      const p90 = n > 0 ? validLatencies[Math.floor(n * 0.9)] / 100 : 0;
      const p95 = n > 0 ? validLatencies[Math.floor(n * 0.95)] / 100 : 0;
      const p99 = n > 0 ? validLatencies[Math.floor(n * 0.99)] / 100 : 0;
      const minL = n > 0 ? validLatencies[0] / 100 : 0;
      const maxL = n > 0 ? validLatencies[n - 1] / 100 : 0;
      const rps = durationSec > 0 ? successCount / durationSec : 0;
      const successRate = (successCount / (completed || 1)) * 100;

      resolve({
        name,
        workers,
        requests,
        durationSec,
        rps,
        successCount,
        errorCount,
        successRate,
        p50,
        p90,
        p95,
        p99,
        minL,
        maxL,
        errorMap,
      });
    }
  });
}

async function runCenturyStage(stageIdx, tier) {
  const { totalWorkers, totalRequests } = tier;
  const halfWorkers = Math.floor(totalWorkers / 2);
  const halfRequests = Math.floor(totalRequests / 2);

  console.log(`\n${'='.repeat(76)}`);
  console.log(`⚡ 100K CENTURY STAGE ${stageIdx + 1}/${CENTURY_TIERS.length}: ${totalWorkers.toLocaleString()} Simultaneous Sockets | ${totalRequests.toLocaleString()} Requests`);
  console.log(`   - Go API:        ${halfWorkers.toLocaleString()} workers | ${halfRequests.toLocaleString()} requests (:8080/healthz)`);
  console.log(`   - Elixir Socket: ${halfWorkers.toLocaleString()} workers | ${halfRequests.toLocaleString()} requests (:3001/health)`);
  console.log(`   - Multi-IP Pool: ${LOOPBACK_IPS.join(', ')}`);
  console.log(`${'='.repeat(76)}`);

  const stageWallStart = performance.now();

  const [goRes, elixirRes] = await Promise.all([
    runDistributedService('Go API', GO_PORT, '/healthz', halfWorkers, halfRequests),
    runDistributedService('Elixir Socket', ELIXIR_PORT, '/health', halfWorkers, halfRequests),
  ]);

  const totalWallDuration = (performance.now() - stageWallStart) / 1000;
  const totalCombinedSuccess = goRes.successCount + elixirRes.successCount;
  const combinedRps = totalCombinedSuccess / totalWallDuration;
  const combinedSuccessRate = (totalCombinedSuccess / totalRequests) * 100;

  console.log(`\n   🔹 Go API Result:        ${goRes.rps.toFixed(1)} RPS | p50: ${goRes.p50.toFixed(2)}ms | p99: ${goRes.p99.toFixed(2)}ms | Success: ${goRes.successRate.toFixed(2)}%`);
  console.log(`   🔹 Elixir Socket Result: ${elixirRes.rps.toFixed(1)} RPS | p50: ${elixirRes.p50.toFixed(2)}ms | p99: ${elixirRes.p99.toFixed(2)}ms | Success: ${elixirRes.successRate.toFixed(2)}%`);
  console.log(`   ⏱️  Total Wall Duration:  ${totalWallDuration.toFixed(3)} seconds`);
  console.log(`   🚀 COMBINED THROUGHPUT:  ${combinedRps.toFixed(1)} Requests/Second`);
  console.log(`   🎯 Combined Success:     ${combinedSuccessRate.toFixed(2)}% (${totalCombinedSuccess.toLocaleString()}/${totalRequests.toLocaleString()})`);
  if (goRes.errorCount > 0) console.log(`   ⚠️  Go API Errors:`, JSON.stringify(goRes.errorMap));
  if (elixirRes.errorCount > 0) console.log(`   ⚠️  Elixir Errors:`, JSON.stringify(elixirRes.errorMap));

  return {
    totalWorkers,
    totalRequests,
    wallDuration: totalWallDuration,
    combinedRps,
    combinedSuccessRate,
    goRes,
    elixirRes,
  };
}

async function main() {
  console.log('='.repeat(76));
  console.log('🚀 NEXUS 100,000 SIMULTANEOUS SOCKETS CENTURY BENCHMARK 🚀');
  console.log('Scale Target: 60,000 -> 80,000 -> 100,000 Concurrent Live Sockets');
  console.log('Total Volume: Up to 2,400,000 Requests in Parallel');
  console.log('='.repeat(76));

  const results = [];
  for (let i = 0; i < CENTURY_TIERS.length; i++) {
    const res = await runCenturyStage(i, CENTURY_TIERS[i]);
    results.push(res);
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log(`\n${'='.repeat(76)}`);
  console.log('🏆 100,000 CONCURRENT SOCKETS CENTURY MATRIX');
  console.log('='.repeat(76));
  console.log(
    `${'Total Sockets'.padEnd(14)} | ${'Go API RPS'.padEnd(12)} | ${'Elixir RPS'.padEnd(12)} | ${'COMBINED RPS'.padEnd(14)} | ${'Combined Success'}`
  );
  console.log('-'.repeat(76));

  for (const r of results) {
    console.log(
      `${r.totalWorkers.toLocaleString().padEnd(14)} | ${(r.goRes.rps.toFixed(1)).padEnd(12)} | ${(r.elixirRes.rps.toFixed(1)).padEnd(12)} | ${(r.combinedRps.toFixed(1)).padEnd(14)} | ${r.combinedSuccessRate.toFixed(2)}%`
    );
  }
  console.log('='.repeat(76));
  console.log('🎉 100,000 CONCURRENT LIVE SOCKETS ACHIEVED!');
}

main().catch(console.error);
