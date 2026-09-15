#!/usr/bin/env node
/**
 * Elixir / Bandit Extreme Breaking Point Stress Test
 * Ramps up concurrent workers from 2,500 to 15,000+ to find the hardware / runtime breaking point.
 *
 * Target: http://127.0.0.1:3001/health
 */

import http from 'node:http';
import { performance } from 'node:perf_hooks';

const targetUrlStr = process.argv[2] || 'http://127.0.0.1:3001/health';
const targetUrl = new URL(targetUrlStr);

const TIERS = [
  { workers: 2500, requests: 50000 },
  { workers: 5000, requests: 100000 },
  { workers: 7500, requests: 100000 },
  { workers: 10000, requests: 100000 },
  { workers: 12500, requests: 100000 },
  { workers: 15000, requests: 150000 },
];

async function runTier(stageIdx, tier) {
  const { workers, requests } = tier;
  console.log(`\n${'='.repeat(74)}`);
  console.log(`💥 STAGE ${stageIdx + 1}/${TIERS.length}: ${workers.toLocaleString()} Concurrent Workers | ${requests.toLocaleString()} Requests`);
  console.log(`${'='.repeat(74)}`);

  const agent = new http.Agent({
    keepAlive: true,
    maxSockets: workers + 500,
    keepAliveMsecs: 120000,
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
  const errorMap = {};
  let successCount = 0;
  let errorCount = 0;
  let completed = 0;
  let launched = 0;

  const startTime = performance.now();

  return new Promise((resolve) => {
    function fire(wId) {
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
        latencies.push(dur);
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

    // Launch workers with micro-staggering to respect kernel SYN queue
    const batchSize = Math.min(200, workers);
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

      latencies.sort((a, b) => a - b);
      const n = latencies.length;
      const p50 = n > 0 ? latencies[Math.floor(n * 0.5)] : 0;
      const p90 = n > 0 ? latencies[Math.floor(n * 0.9)] : 0;
      const p95 = n > 0 ? latencies[Math.floor(n * 0.95)] : 0;
      const p99 = n > 0 ? latencies[Math.floor(n * 0.99)] : 0;
      const minL = n > 0 ? latencies[0] : 0;
      const maxL = n > 0 ? latencies[n - 1] : 0;
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

      const broken = successPct < 85.0 || p50 > 3000.0;
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
  console.log('='.repeat(74));
  console.log('🌋 ELIXIR / BANDIT BREAKING POINT STRESS TEST 🌋');
  console.log(`Target Service: ${targetUrlStr}`);
  console.log(`Ramp Profile:   2,500 -> 5,000 -> 7,500 -> 10,000 -> 12,500 -> 15,000 Workers`);
  console.log('='.repeat(74));

  const results = [];
  let brokenAt = null;

  for (let i = 0; i < TIERS.length; i++) {
    const res = await runTier(i, TIERS[i]);
    results.push(res);

    if (res.broken) {
      brokenAt = res.workers;
      console.log(`\n🚨 BREAKING POINT DETECTED at ${res.workers.toLocaleString()} concurrent workers!`);
      console.log(`Success rate dropped to ${res.successPct.toFixed(2)}% with ${res.errors.toLocaleString()} errors.`);
      break;
    }

    // Cooldown
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(`\n${'='.repeat(74)}`);
  console.log('🏆 BREAKING POINT TEST MATRIX RESULTS');
  console.log('='.repeat(74));
  console.log(
    `${'Workers'.padEnd(8)} | ${'Requests'.padEnd(10)} | ${'Throughput'.padEnd(12)} | ${'Success'.padEnd(8)} | ${'p50'.padEnd(8)} | ${'p95'.padEnd(8)} | ${'p99'.padEnd(8)} | ${'Status'}`
  );
  console.log('-'.repeat(74));

  for (const r of results) {
    const status = r.broken ? '💥 BROKEN' : '✅ SURVIVED';
    console.log(
      `${r.workers.toString().padEnd(8)} | ${r.requests.toLocaleString().padEnd(10)} | ${(r.rps.toFixed(1) + ' RPS').padEnd(12)} | ${(r.successPct.toFixed(1) + '%').padEnd(8)} | ${(r.p50.toFixed(2) + 'ms').padEnd(8)} | ${(r.p95.toFixed(2) + 'ms').padEnd(8)} | ${(r.p99.toFixed(2) + 'ms').padEnd(8)} | ${status}`
    );
  }
  console.log('='.repeat(74));
  if (!brokenAt) {
    console.log(`🎉 UNBREAKABLE: Elixir survived up to ${TIERS[TIERS.length - 1].workers.toLocaleString()} concurrent workers without breaking!`);
  }
}

main().catch(console.error);
