#!/usr/bin/env node
/**
 * Nexus Hyperscale Extreme Concurrency Benchmark
 * Ramps from 20,000 to 40,000 Concurrent Workers across 1.5 Million Requests.
 * Uses high-performance typed arrays (Uint32Array) for zero-GC memory efficiency.
 *
 * Target: http://127.0.0.1:3001/health
 */

import http from 'node:http';
import { performance } from 'node:perf_hooks';

const targetUrlStr = process.argv[2] || 'http://127.0.0.1:3001/health';
const targetUrl = new URL(targetUrlStr);

const HYPER_TIERS = [
  { workers: 20000, requests: 200000 },
  { workers: 25000, requests: 250000 },
  { workers: 30000, requests: 300000 },
  { workers: 35000, requests: 350000 },
  { workers: 40000, requests: 400000 },
];

async function runHyperTier(stageIdx, tier) {
  const { workers, requests } = tier;
  console.log(`\n${'='.repeat(76)}`);
  console.log(`⚡ HYPERSCALE STAGE ${stageIdx + 1}/${HYPER_TIERS.length}: ${workers.toLocaleString()} Concurrent Workers | ${requests.toLocaleString()} Requests`);
  console.log(`${'='.repeat(76)}`);

  const agent = new http.Agent({
    keepAlive: true,
    maxSockets: workers + 2000,
    keepAliveMsecs: 300000,
  });

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || 80,
    path: targetUrl.pathname + targetUrl.search,
    method: 'GET',
    agent: agent,
    headers: {
      Connection: 'keep-alive',
      Accept: '*/*',
    },
  };

  // Typed array for zero-GC latency tracking (fixed 4 bytes per request)
  const latencies = new Uint32Array(requests);
  const errorMap = {};
  let successCount = 0;
  let errorCount = 0;
  let completed = 0;
  let launched = 0;

  const startTime = performance.now();

  return new Promise((resolve) => {
    function fire(wId) {
      if (launched >= requests) return;
      const curReqIdx = launched++;

      const reqStart = performance.now();
      const req = http.request(options, (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          const durMs = performance.now() - reqStart;
          if (curReqIdx < requests) {
            latencies[curReqIdx] = Math.min(Math.round(durMs * 100), 4294967295); // 0.01ms resolution
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
        const durMs = performance.now() - reqStart;
        if (curReqIdx < requests) {
          latencies[curReqIdx] = Math.min(Math.round(durMs * 100), 4294967295);
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

    // Launch workers with smooth micro-staggering to prevent SYN backlog spike
    const batchSize = Math.min(300, workers);
    let launchedWorkers = 0;
    const rampTimer = setInterval(() => {
      const end = Math.min(launchedWorkers + batchSize, workers, requests);
      for (; launchedWorkers < end; launchedWorkers++) {
        fire(launchedWorkers);
      }
      if (launchedWorkers >= workers || launchedWorkers >= requests) {
        clearInterval(rampTimer);
      }
    }, 10);

    function finish() {
      const totalSec = (performance.now() - startTime) / 1000;
      agent.destroy();

      // Sort latency subarray of actual completed count
      const validLatencies = latencies.subarray(0, completed).sort();
      const n = validLatencies.length;
      const p50 = n > 0 ? validLatencies[Math.floor(n * 0.5)] / 100 : 0;
      const p90 = n > 0 ? validLatencies[Math.floor(n * 0.9)] / 100 : 0;
      const p95 = n > 0 ? validLatencies[Math.floor(n * 0.95)] / 100 : 0;
      const p99 = n > 0 ? validLatencies[Math.floor(n * 0.99)] / 100 : 0;
      const minL = n > 0 ? validLatencies[0] / 100 : 0;
      const maxL = n > 0 ? validLatencies[n - 1] / 100 : 0;
      const rps = totalSec > 0 ? successCount / totalSec : 0;
      const successPct = (successCount / (completed || 1)) * 100;

      console.log(`   ⏱️  Total Duration:     ${totalSec.toFixed(3)}s`);
      console.log(`   🔥 Throughput:         ${rps.toFixed(1)} req/sec`);
      console.log(`   🎯 Success Rate:       ${successPct.toFixed(2)}% (${successCount.toLocaleString()}/${completed.toLocaleString()})`);
      console.log(`   📈 Latency:            p50: ${p50.toFixed(2)}ms | p90: ${p90.toFixed(2)}ms | p95: ${p95.toFixed(2)}ms | p99: ${p99.toFixed(2)}ms`);
      console.log(`   ⚡ Latency Extrems:    min: ${minL.toFixed(2)}ms | max: ${maxL.toFixed(2)}ms`);
      if (Object.keys(errorMap).length > 0) {
        console.log(`   ⚠️  Error Breakdown:     ${JSON.stringify(errorMap)}`);
      } else {
        console.log(`   ✨ Zero Errors Detected!`);
      }

      const broken = successPct < 85.0 || p50 > 5000.0;
      resolve({
        workers,
        requests,
        duration: totalSec,
        rps,
        successPct,
        p50,
        p90,
        p95,
        p99,
        errors: errorCount,
        errorMap,
        broken,
      });
    }
  });
}

async function main() {
  console.log('='.repeat(76));
  console.log('🚀 NEXUS HYPERSCALE MULTI-CORE BENCHMARK (20,000 -> 40,000 WORKERS) 🚀');
  console.log(`Target Service: ${targetUrlStr}`);
  console.log(`Target Volume:  Up to 1,500,000 Total Requests`);
  console.log('='.repeat(76));

  const results = [];
  let brokenAt = null;

  for (let i = 0; i < HYPER_TIERS.length; i++) {
    const res = await runHyperTier(i, HYPER_TIERS[i]);
    results.push(res);

    if (res.broken) {
      brokenAt = res.workers;
      console.log(`\n🚨 CEILING DETECTED at ${res.workers.toLocaleString()} concurrent workers!`);
      break;
    }

    // Cooldown 2s to allow socket buffers to clear
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`\n${'='.repeat(76)}`);
  console.log('🏆 HYPERSCALE RESULTS SUMMARY (20,000 to 40,000 WORKERS)');
  console.log('='.repeat(76));
  console.log(
    `${'Workers'.padEnd(8)} | ${'Requests'.padEnd(10)} | ${'Throughput'.padEnd(12)} | ${'Success'.padEnd(8)} | ${'p50'.padEnd(8)} | ${'p95'.padEnd(8)} | ${'p99'.padEnd(8)} | ${'Status'}`
  );
  console.log('-'.repeat(76));

  for (const r of results) {
    const status = r.broken ? '💥 BROKEN' : '✅ SURVIVED';
    console.log(
      `${r.workers.toString().padEnd(8)} | ${r.requests.toLocaleString().padEnd(10)} | ${(r.rps.toFixed(1) + ' RPS').padEnd(12)} | ${(r.successPct.toFixed(1) + '%').padEnd(8)} | ${(r.p50.toFixed(2) + 'ms').padEnd(8)} | ${(r.p95.toFixed(2) + 'ms').padEnd(8)} | ${(r.p99.toFixed(2) + 'ms').padEnd(8)} | ${status}`
    );
  }
  console.log('='.repeat(76));
  if (!brokenAt) {
    console.log(`🎉 UNSTOPPABLE: Elixir survived all the way to 40,000 simultaneous connections!`);
  }
}

main().catch(console.error);
