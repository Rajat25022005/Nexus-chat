#!/usr/bin/env node
/**
 * Dual-Service Colossus Benchmark: Go API (:8080) & Elixir Socket (:3001)
 * 
 * Pushes both services simultaneously up to 50,000 simultaneous concurrent sockets
 * and nearly 1.7 million requests, completely saturating the M2 chip and OS network stack.
 */

import http from 'node:http';
import { performance } from 'node:perf_hooks';

const GO_PORT = 8080;
const ELIXIR_PORT = 3001;

const COLOSSUS_TIERS = [
  { totalWorkers: 30000, totalRequests: 300000 },
  { totalWorkers: 40000, totalRequests: 400000 },
  { totalWorkers: 46000, totalRequests: 460000 },
  { totalWorkers: 50000, totalRequests: 500000 },
];

function runSimultaneousTarget(name, port, path, workers, requests) {
  const agent = new http.Agent({
    keepAlive: true,
    maxSockets: workers + 1500,
    keepAliveMsecs: 300000,
  });

  const options = {
    hostname: '127.0.0.1',
    port: port,
    path: path,
    method: 'GET',
    agent: agent,
    headers: {
      Connection: 'keep-alive',
      Accept: '*/*',
    },
  };

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

    // Micro-stagger connection launch (350 workers every 10ms)
    const batchSize = Math.min(350, workers);
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

    function finish() {
      const durationSec = (performance.now() - start) / 1000;
      agent.destroy();

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

async function runColossusStage(stageIdx, tier) {
  const { totalWorkers, totalRequests } = tier;
  const halfWorkers = Math.floor(totalWorkers / 2);
  const halfRequests = Math.floor(totalRequests / 2);

  console.log(`\n${'='.repeat(76)}`);
  console.log(`⚡ COLOSSUS STAGE ${stageIdx + 1}/${COLOSSUS_TIERS.length}: ${totalWorkers.toLocaleString()} Simultaneous Sockets | ${totalRequests.toLocaleString()} Requests`);
  console.log(`   - Go API:        ${halfWorkers.toLocaleString()} workers | ${halfRequests.toLocaleString()} requests (:8080/healthz)`);
  console.log(`   - Elixir Socket: ${halfWorkers.toLocaleString()} workers | ${halfRequests.toLocaleString()} requests (:3001/health)`);
  console.log(`${'='.repeat(76)}`);

  const stageWallStart = performance.now();

  // Parallel simultaneous dispatch across both services at the exact same millisecond
  const [goRes, elixirRes] = await Promise.all([
    runSimultaneousTarget('Go API', GO_PORT, '/healthz', halfWorkers, halfRequests),
    runSimultaneousTarget('Elixir Socket', ELIXIR_PORT, '/health', halfWorkers, halfRequests),
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
  console.log('🌋 DUAL-SERVICE COLOSSUS: 30,000 -> 50,000 SIMULTANEOUS SOCKETS 🌋');
  console.log('Targets: Go API (:8080) AND Elixir Socket (:3001) simultaneously');
  console.log('Total Volume: Up to 1,660,000 Requests in Parallel');
  console.log('='.repeat(76));

  const results = [];
  for (let i = 0; i < COLOSSUS_TIERS.length; i++) {
    const res = await runColossusStage(i, COLOSSUS_TIERS[i]);
    results.push(res);
    // 2.5s cooldown between stages
    await new Promise((r) => setTimeout(r, 2500));
  }

  console.log(`\n${'='.repeat(76)}`);
  console.log('🏆 DUAL-SERVICE COLOSSUS PERFORMANCE MATRIX');
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
  console.log('🎉 COLOSSUS BENCHMARK COMPLETED WITH FULL DUAL SATURATION!');
}

main().catch(console.error);
