#!/usr/bin/env node
/**
 * Stepped Concurrency Ramp Stress Test: 100 to 5,000 Concurrent Workers
 * Tests system resilience, throughput, and latency scaling from 100 up to 5,000 parallel workers.
 *
 * Usage:
 *   node scripts/ramp_stress_test.mjs [TARGET_URL]
 * Defaults to http://127.0.0.1:3001/health (Elixir Socket) or http://127.0.0.1:8080/healthz (Go API)
 */

import http from 'node:http';
import { performance } from 'node:perf_hooks';

const targetUrlStr = process.argv[2] || 'http://127.0.0.1:3001/health';
const targetUrl = new URL(targetUrlStr);

const RAMP_TIERS = [
  { workers: 100, requests: 20000 },
  { workers: 500, requests: 20000 },
  { workers: 1000, requests: 20000 },
  { workers: 2500, requests: 20000 },
  { workers: 5000, requests: 100000 }, // The grand finale: 100,000 requests with 5,000 workers!
];

async function runTier(tierIndex, tier) {
  const { workers, requests } = tier;
  console.log(`\n${'='.repeat(72)}`);
  console.log(`🚀 STAGE ${tierIndex + 1}/${RAMP_TIERS.length}: ${workers.toLocaleString()} Concurrent Workers | ${requests.toLocaleString()} Requests`);
  console.log(`${'='.repeat(72)}`);

  const agent = new http.Agent({
    keepAlive: true,
    maxSockets: workers + 100,
    keepAliveMsecs: 60000,
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

  const latencies = [];
  let successCount = 0;
  let errorCount = 0;
  let completed = 0;
  let launched = 0;

  const startTime = performance.now();

  return new Promise((resolve) => {
    function fire(workerId) {
      if (launched >= requests) return;
      launched++;

      const reqStart = performance.now();
      const req = http.request(options, (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          const dur = performance.now() - reqStart;
          latencies.push(dur);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            successCount++;
          } else {
            errorCount++;
          }
          completed++;
          if (launched < requests) {
            fire(workerId);
          } else if (completed === requests) {
            finish();
          }
        });
      });

      req.on('error', (err) => {
        const dur = performance.now() - reqStart;
        latencies.push(dur);
        errorCount++;
        completed++;
        if (launched < requests) {
          fire(workerId);
        } else if (completed === requests) {
          finish();
        }
      });

      req.end();
    }

    // Launch initial batch of workers
    for (let w = 0; w < workers && w < requests; w++) {
      fire(w);
    }

    function finish() {
      const totalSec = (performance.now() - startTime) / 1000;
      agent.destroy();

      latencies.sort((a, b) => a - b);
      const n = latencies.length;
      const p50 = n > 0 ? latencies[Math.floor(n * 0.5)] : 0;
      const p90 = n > 0 ? latencies[Math.floor(n * 0.9)] : 0;
      const p95 = n > 0 ? latencies[Math.floor(n * 0.95)] : 0;
      const p99 = n > 0 ? latencies[Math.floor(n * 0.99)] : 0;
      const minL = n > 0 ? latencies[0] : 0;
      const maxL = n > 0 ? latencies[n - 1] : 0;
      const rps = totalSec > 0 ? successCount / totalSec : 0;

      console.log(`   ⏱️  Duration:     ${totalSec.toFixed(3)}s`);
      console.log(`   🔥 Throughput:   ${rps.toFixed(1)} req/sec`);
      console.log(`   🎯 Success Rate: ${((successCount / (completed || 1)) * 100).toFixed(2)}% (${successCount.toLocaleString()}/${completed.toLocaleString()})`);
      console.log(`   📈 Latency:      p50: ${p50.toFixed(2)}ms | p90: ${p90.toFixed(2)}ms | p95: ${p95.toFixed(2)}ms | p99: ${p99.toFixed(2)}ms`);
      console.log(`   ⚡ Range:        min: ${minL.toFixed(2)}ms | max: ${maxL.toFixed(2)}ms`);

      resolve({
        workers,
        requests,
        duration: totalSec,
        rps,
        successRate: (successCount / (completed || 1)) * 100,
        p50,
        p90,
        p95,
        p99,
        errors: errorCount,
      });
    }
  });
}

async function main() {
  console.log('='.repeat(72));
  console.log('🔥 NEXUS STEPPED CONCURRENCY RAMP (100 -> 5,000 WORKERS) 🔥');
  console.log(`Target Service: ${targetUrlStr}`);
  console.log('='.repeat(72));

  const results = [];
  for (let i = 0; i < RAMP_TIERS.length; i++) {
    const res = await runTier(i, RAMP_TIERS[i]);
    results.push(res);
    // 500ms cooldown between tiers to allow socket cleanup
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n${'='.repeat(72)}`);
  console.log('📊 CONCURRENCY RAMP PERFORMANCE MATRIX (100 to 5,000 WORKERS)');
  console.log('='.repeat(72));
  console.log(
    `${'Workers'.padEnd(8)} | ${'Requests'.padEnd(10)} | ${'Throughput'.padEnd(12)} | ${'Success'.padEnd(8)} | ${'p50'.padEnd(8)} | ${'p95'.padEnd(8)} | ${'p99'}`
  );
  console.log('-'.repeat(72));

  for (const r of results) {
    console.log(
      `${r.workers.toString().padEnd(8)} | ${r.requests.toLocaleString().padEnd(10)} | ${(r.rps.toFixed(1) + ' RPS').padEnd(12)} | ${(r.successRate.toFixed(1) + '%').padEnd(8)} | ${(r.p50.toFixed(2) + 'ms').padEnd(8)} | ${(r.p95.toFixed(2) + 'ms').padEnd(8)} | ${r.p99.toFixed(2)}ms`
    );
  }
  console.log('='.repeat(72));
}

main().catch(console.error);
