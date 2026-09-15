#!/usr/bin/env node
/**
 * ==============================================================================
 * Nexus API — 10,000 Requests High-Concurrency Stress Test
 * ==============================================================================
 *
 * Configurable parameters via environment variables:
 *   API_URL     : Base URL (default: http://localhost:8080)
 *   REQUESTS    : Total requests to execute (default: 10000)
 *   CONCURRENCY : Parallel in-flight requests (default: 300)
 *
 * Usage:
 *   node tests/load/api_10k_test.js
 *   REQUESTS=20000 CONCURRENCY=500 node tests/load/api_10k_test.js
 */

import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';

const API_URL = process.env.API_URL || 'http://localhost:8080';
const TARGET_REQUESTS = parseInt(process.env.REQUESTS || '10000', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '300', 10);

const targetUrl = new URL(API_URL);
const isHttps = targetUrl.protocol === 'https:';
const clientModule = isHttps ? https : http;

const agent = new clientModule.Agent({
  keepAlive: true,
  maxSockets: CONCURRENCY + 50,
  keepAliveMsecs: 60000,
});

function calculatePercentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
  return sorted[index];
}

async function run10kStressTest() {
  console.log('='.repeat(70));
  console.log('🔥 NEXUS API 10,000 REQUESTS STRESS TEST');
  console.log('='.repeat(70));
  console.log(`Target URL : ${API_URL}`);
  console.log(`Requests   : ${TARGET_REQUESTS.toLocaleString()}`);
  console.log(`Concurrency: ${CONCURRENCY} parallel workers`);
  console.log('='.repeat(70));

  const latencies = [];
  let launched = 0;
  let completed = 0;
  let successful = 0;
  let failed = 0;

  const testStartTime = performance.now();

  const reqOptions = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (isHttps ? 443 : 80),
    path: '/healthz',
    method: 'GET',
    agent: agent,
    headers: {
      Accept: 'application/json',
      Connection: 'keep-alive',
    },
    timeout: 8000,
  };

  const progressInterval = setInterval(() => {
    const elapsed = ((performance.now() - testStartTime) / 1000).toFixed(1);
    const rps = (completed / Math.max(elapsed, 0.1)).toFixed(1);
    const percent = ((completed / TARGET_REQUESTS) * 100).toFixed(1);
    process.stdout.write(
      `\r⚡ [${percent}%] Completed: ${completed.toLocaleString()}/${TARGET_REQUESTS.toLocaleString()} | RPS: ${rps} | Errors: ${failed}`
    );
  }, 500);

  await new Promise((resolve) => {
    function dispatchWorker() {
      if (launched >= TARGET_REQUESTS) return;
      launched++;

      const reqStart = performance.now();
      const req = clientModule.request(reqOptions, (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          latencies.push(performance.now() - reqStart);
          if (res.statusCode >= 200 && res.statusCode < 400) {
            successful++;
          } else {
            failed++;
          }
          completed++;

          if (completed >= TARGET_REQUESTS) {
            resolve();
          } else {
            dispatchWorker();
          }
        });
      });

      req.on('error', () => {
        failed++;
        completed++;
        if (completed >= TARGET_REQUESTS) {
          resolve();
        } else {
          dispatchWorker();
        }
      });

      req.on('timeout', () => {
        req.destroy();
        failed++;
        completed++;
        if (completed >= TARGET_REQUESTS) {
          resolve();
        } else {
          dispatchWorker();
        }
      });

      req.end();
    }

    // Launch concurrent pool
    for (let i = 0; i < CONCURRENCY; i++) {
      dispatchWorker();
    }
  });

  clearInterval(progressInterval);
  agent.destroy();

  const totalElapsedSec = (performance.now() - testStartTime) / 1000;
  latencies.sort((a, b) => a - b);

  const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  const p50 = calculatePercentile(latencies, 50);
  const p90 = calculatePercentile(latencies, 90);
  const p95 = calculatePercentile(latencies, 95);
  const p99 = calculatePercentile(latencies, 99);
  const rps = (successful / totalElapsedSec).toFixed(2);
  const errorRate = ((failed / TARGET_REQUESTS) * 100).toFixed(2);

  console.log('\n\n' + '='.repeat(70));
  console.log('📊 10K STRESS TEST RESULTS');
  console.log('='.repeat(70));
  console.log(`Total Requests Completed : ${completed.toLocaleString()}`);
  console.log(`Successful Requests      : ${successful.toLocaleString()} (${(100 - parseFloat(errorRate)).toFixed(2)}%)`);
  console.log(`Failed Requests          : ${failed.toLocaleString()} (${errorRate}%)`);
  console.log(`Total Elapsed Time       : ${totalElapsedSec.toFixed(2)} seconds`);
  console.log(`Throughput Rate (RPS)    : ${rps} req/sec`);
  console.log('-'.repeat(70));
  console.log(`Average Latency          : ${avgLatency.toFixed(2)} ms`);
  console.log(`p50 Latency (Median)     : ${p50.toFixed(2)} ms`);
  console.log(`p90 Latency              : ${p90.toFixed(2)} ms`);
  console.log(`p95 Latency              : ${p95.toFixed(2)} ms`);
  console.log(`p99 Latency (Tail)       : ${p99.toFixed(2)} ms`);
  console.log('='.repeat(70));

  if (failed > TARGET_REQUESTS * 0.05) {
    console.log('❌ Result: FAILED (High error rate)\n');
    process.exit(1);
  } else {
    console.log('✅ Result: PASSED (System rock-solid under stress)\n');
    process.exit(0);
  }
}

run10kStressTest().catch((err) => {
  console.error('Fatal 10k test error:', err);
  process.exit(1);
});
