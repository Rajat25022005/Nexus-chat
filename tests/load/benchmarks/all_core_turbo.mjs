#!/usr/bin/env node
/**
 * All-Core Turbo Benchmark for Apple Silicon M2
 * Forks 1 worker per CPU core (8 workers) with persistent keep-alive connection pools.
 * Measures aggregate throughput, latency distribution, and per-core performance.
 *
 * Usage:
 *   node scripts/all_core_turbo.mjs <url> <requests_per_worker> <concurrency_per_worker>
 * Example:
 *   node scripts/all_core_turbo.mjs http://127.0.0.1:8080/healthz 15000 30
 */

import cluster from 'node:cluster';
import http from 'node:http';
import os from 'node:os';
import { performance } from 'node:perf_hooks';

const numCPUs = os.cpus().length;
const targetUrl = process.argv[2] || 'http://127.0.0.1:8080/healthz';
const reqsPerWorker = parseInt(process.argv[3] || '10000', 10);
const concurrency = parseInt(process.argv[4] || '25', 10);

if (cluster.isPrimary) {
  const totalReqs = numCPUs * reqsPerWorker;
  const totalConcurrency = numCPUs * concurrency;
  console.log('='.repeat(72));
  console.log(`⚡ ALL-CORE TURBO SATURATION BENCHMARK (Apple M2: ${numCPUs} Cores) ⚡`);
  console.log(`🎯 Target URL:          ${targetUrl}`);
  console.log(`⚙️  Workers (CPU Cores):  ${numCPUs} (1 worker per physical/logical core)`);
  console.log(`🔌 Concurrency:         ${totalConcurrency} total (${concurrency} per core)`);
  console.log(`📦 Target Requests:     ${totalReqs} (${reqsPerWorker.toLocaleString()} per core)`);
  console.log('='.repeat(72));

  let completedWorkers = 0;
  const workerStats = [];
  const startTime = performance.now();

  for (let i = 0; i < numCPUs; i++) {
    const worker = cluster.fork({
      WORKER_ID: i,
      TARGET_URL: targetUrl,
      REQS: reqsPerWorker,
      CONCURRENCY: concurrency,
    });

    worker.on('message', (msg) => {
      workerStats.push(msg);
      completedWorkers++;
      if (completedWorkers === numCPUs) {
        const totalDurationSec = (performance.now() - startTime) / 1000;
        printSummary(workerStats, totalDurationSec, totalReqs);
        process.exit(0);
      }
    });
  }

  function printSummary(stats, wallSec, expectedReqs) {
    let totalSuccess = 0;
    let totalFailed = 0;
    const allLatencies = [];

    stats.sort((a, b) => a.workerId - b.workerId);

    console.log('\n📊 Per-Core Worker Performance:');
    console.log('-'.repeat(72));
    console.log(
      `${'Core'.padEnd(8)} | ${'Completed'.padEnd(12)} | ${'Errors'.padEnd(8)} | ${'Core RPS'.padEnd(12)} | ${'Core p50'}`
    );
    console.log('-'.repeat(72));

    for (const w of stats) {
      totalSuccess += w.success;
      totalFailed += w.failed;
      allLatencies.push(...w.latencies);
      console.log(
        `Core #${w.workerId.toString().padEnd(3)} | ${w.success.toString().padEnd(12)} | ${w.failed.toString().padEnd(8)} | ${(w.success / w.durationSec).toFixed(1).padEnd(12)} | ${w.p50.toFixed(2)} ms`
      );
    }

    allLatencies.sort((a, b) => a - b);
    const n = allLatencies.length;
    const p50 = n > 0 ? allLatencies[Math.floor(n * 0.5)] : 0;
    const p90 = n > 0 ? allLatencies[Math.floor(n * 0.9)] : 0;
    const p95 = n > 0 ? allLatencies[Math.floor(n * 0.95)] : 0;
    const p99 = n > 0 ? allLatencies[Math.floor(n * 0.99)] : 0;
    const minL = n > 0 ? allLatencies[0] : 0;
    const maxL = n > 0 ? allLatencies[n - 1] : 0;

    const aggregateRPS = totalSuccess / wallSec;

    console.log('='.repeat(72));
    console.log('🏆 AGGREGATE ALL-CORE SATURATION RESULTS');
    console.log('='.repeat(72));
    console.log(`⏱️  Total Elapsed Wall Time:  ${wallSec.toFixed(3)} seconds`);
    console.log(`🚀 Aggregate Peak Throughput: ${aggregateRPS.toFixed(1)} Requests/Sec`);
    console.log(
      `🎯 Success Rate:              ${((totalSuccess / (totalSuccess + totalFailed || 1)) * 100).toFixed(2)}% (${totalSuccess}/${expectedReqs})`
    );
    console.log(
      `📈 Latency (Round-Trip):      p50: ${p50.toFixed(2)}ms | p90: ${p90.toFixed(2)}ms | p95: ${p95.toFixed(2)}ms | p99: ${p99.toFixed(2)}ms`
    );
    console.log(`⚡ Min / Max Latency:         min: ${minL.toFixed(2)}ms | max: ${maxL.toFixed(2)}ms`);
    console.log('='.repeat(72));
  }
} else {
  // Worker Process: Executes on a dedicated core
  const workerId = parseInt(process.env.WORKER_ID, 10);
  const url = new URL(process.env.TARGET_URL);
  const totalRequests = parseInt(process.env.REQS, 10);
  const workerConcurrency = parseInt(process.env.CONCURRENCY, 10);

  const agent = new http.Agent({
    keepAlive: true,
    maxSockets: workerConcurrency * 2,
    keepAliveMsecs: 60000,
  });

  const options = {
    hostname: url.hostname,
    port: url.port || 80,
    path: url.pathname + url.search,
    method: 'GET',
    agent: agent,
    headers: {
      Connection: 'keep-alive',
      Accept: '*/*',
    },
  };

  const latencies = [];
  let successCount = 0;
  let failedCount = 0;
  let inFlight = 0;
  let launched = 0;

  const workerStart = performance.now();

  function fireRequest() {
    if (launched >= totalRequests) return;
    launched++;
    inFlight++;

    const reqStart = performance.now();
    const req = http.request(options, (res) => {
      res.on('data', () => {}); // Consume body stream quickly
      res.on('end', () => {
        const dur = performance.now() - reqStart;
        latencies.push(dur);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          successCount++;
        } else {
          failedCount++;
        }
        inFlight--;
        if (launched < totalRequests) {
          fireRequest();
        } else if (inFlight === 0) {
          finish();
        }
      });
    });

    req.on('error', () => {
      failedCount++;
      inFlight--;
      if (launched < totalRequests) {
        fireRequest();
      } else if (inFlight === 0) {
        finish();
      }
    });

    req.end();
  }

  // Prime the concurrency pool
  for (let c = 0; c < workerConcurrency && c < totalRequests; c++) {
    fireRequest();
  }

  function finish() {
    const durationSec = (performance.now() - workerStart) / 1000;
    latencies.sort((a, b) => a - b);
    const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0;
    process.send({
      workerId,
      success: successCount,
      failed: failedCount,
      durationSec,
      p50,
      latencies,
    });
  }
}
