#!/usr/bin/env node

/**
 * Nexus High-Stress & Maximum Overload Benchmark Suite
 * 
 * Tiers:
 *   1. Stress        : 500 workers   | 20,000 requests
 *   2. Breaking Point: 1,000 workers | 20,000 requests
 *   3. Extreme       : 2,000 workers | 25,000 requests
 *   4. Ultra         : 3,500 workers | 30,000 requests
 *   5. Max Overload  : 5,000 workers | 35,000 requests
 * 
 * Outputs structured JSON results to tests/load/benchmark_results.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = path.join(__dirname, 'benchmark_results.json');
const HIGH_STRESS_OUTPUT_FILE = path.join(__dirname, 'high_stress_benchmark_results.json');

const API_URL = process.env.API_URL || 'http://localhost:8080';
const TEST_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiOWM5OTAzM2UtY2FlNS00ZjcwLThmNDYtM2E3MWU1YzM0NDg3IiwiZW1haWwiOiJsb2FkdGVzdF9hZG1pbkBuZXh1cy50ZXN0IiwiaXNzIjoibmV4dXMtYXBpIiwiZXhwIjoxNzg3NTE1MzMzLCJpYXQiOjE3ODc0Mjg5MzN9.9PUplkAf8A_KwXEKguzoDMcfD-hQwnznsJFxLGbx1LY";
const TEST_TENANT_ID = "a9188ed4-e624-42a9-ad5d-d98054373442";
const TEST_CHAT_ID = "49215c84-c659-437c-a005-e68796cd9a3a";

const TEST_PLAN = [
  { name: 'Stress', workers: 500, requests: 20000 },
  { name: 'Breaking Point', workers: 1000, requests: 20000 },
  { name: 'Extreme', workers: 2000, requests: 25000 },
  { name: 'Ultra', workers: 3500, requests: 30000 },
  { name: 'Max Overload', workers: 5000, requests: 35000 },
];

const endpoints = [
  { label: '/health', path: '/health', auth: false },
  { label: '/api/auth/me', path: '/api/auth/me', auth: true },
  { label: '/api/workspaces', path: `/api/workspaces?tenant_id=${TEST_TENANT_ID}`, auth: true },
  { label: '/api/chats/:id/messages', path: `/api/chats/${TEST_CHAT_ID}/messages?limit=20`, auth: true },
];

function getPercentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.floor((p / 100) * sortedArr.length);
  return parseFloat(sortedArr[Math.min(idx, sortedArr.length - 1)].toFixed(2));
}

async function runSingleStage(stage) {
  console.log('\n───────────────────────────────────────────────────────────────────');
  console.log(`▶ Running Tier: [${stage.name.toUpperCase()}]`);
  console.log(`  Concurrency : ${stage.workers.toLocaleString()} parallel workers`);
  console.log(`  Requests    : ${stage.requests.toLocaleString()} target requests`);
  console.log('───────────────────────────────────────────────────────────────────');

  const stats = {
    totalRequests: stage.requests,
    completed: 0,
    successful: 0,
    failed: 0,
    statusCodes: {},
    latencies: [],
    endpointStats: {
      '/health': { count: 0, errors: 0, latencies: [] },
      '/api/auth/me': { count: 0, errors: 0, latencies: [] },
      '/api/workspaces': { count: 0, errors: 0, latencies: [] },
      '/api/chats/:id/messages': { count: 0, errors: 0, latencies: [] },
    },
    startTime: performance.now(),
    endTime: 0
  };

  let reqIndex = 0;

  async function makeRequest(ep) {
    const url = `${API_URL}${ep.path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (ep.auth) {
      headers['Authorization'] = `Bearer ${TEST_TOKEN}`;
    }

    const start = performance.now();
    try {
      // 25s client timeout to prevent indefinite hanging on overloaded server connections
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(25000)
      });
      const duration = performance.now() - start;

      stats.completed++;
      stats.statusCodes[res.status] = (stats.statusCodes[res.status] || 0) + 1;
      stats.latencies.push(duration);
      stats.endpointStats[ep.label].count++;
      stats.endpointStats[ep.label].latencies.push(duration);

      if (res.ok) {
        stats.successful++;
      } else {
        stats.failed++;
        stats.endpointStats[ep.label].errors++;
      }
    } catch (err) {
      const duration = performance.now() - start;
      stats.completed++;
      stats.failed++;
      stats.latencies.push(duration);
      const errKey = err.name === 'TimeoutError' ? 'TIMEOUT_25S' : 'CONN_ERR';
      stats.statusCodes[errKey] = (stats.statusCodes[errKey] || 0) + 1;
      stats.endpointStats[ep.label].count++;
      stats.endpointStats[ep.label].errors++;
      stats.endpointStats[ep.label].latencies.push(duration);
    }
  }

  async function worker() {
    while (reqIndex < stage.requests) {
      const current = reqIndex++;
      if (current >= stage.requests) break;
      const ep = endpoints[current % endpoints.length];
      await makeRequest(ep);
    }
  }

  const progressInterval = setInterval(() => {
    const elapsed = ((performance.now() - stats.startTime) / 1000).toFixed(1);
    const rps = (stats.completed / (parseFloat(elapsed) || 1)).toFixed(1);
    const pct = ((stats.completed / stage.requests) * 100).toFixed(1);
    process.stdout.write(`\r⏱️  [${elapsed}s] Progress: ${stats.completed.toLocaleString()}/${stage.requests.toLocaleString()} (${pct}%) | Speed: ${rps} Req/s | Errors: ${stats.failed.toLocaleString()}   `);
  }, 200);

  const workers = Array.from({ length: stage.workers }, () => worker());
  await Promise.all(workers);

  clearInterval(progressInterval);
  stats.endTime = performance.now();

  const totalTimeSec = parseFloat(((stats.endTime - stats.startTime) / 1000).toFixed(2));
  stats.latencies.sort((a, b) => a - b);

  const avgLatency = stats.latencies.length ? parseFloat((stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length).toFixed(2)) : 0;
  const throughput = parseFloat((stats.completed / totalTimeSec).toFixed(2));
  const errorRate = parseFloat(((stats.failed / (stats.completed || 1)) * 100).toFixed(2));

  const p50 = getPercentile(stats.latencies, 50);
  const p90 = getPercentile(stats.latencies, 90);
  const p95 = getPercentile(stats.latencies, 95);
  const p99 = getPercentile(stats.latencies, 99);
  const minLatency = stats.latencies[0] ? parseFloat(stats.latencies[0].toFixed(2)) : 0;
  const maxLatency = stats.latencies[stats.latencies.length - 1] ? parseFloat(stats.latencies[stats.latencies.length - 1].toFixed(2)) : 0;

  const endpointSummary = {};
  for (const [label, data] of Object.entries(stats.endpointStats)) {
    data.latencies.sort((a, b) => a - b);
    endpointSummary[label] = {
      requests: data.count,
      errors: data.errors,
      avg_latency_ms: data.latencies.length ? parseFloat((data.latencies.reduce((a, b) => a + b, 0) / data.latencies.length).toFixed(2)) : 0,
      p95_latency_ms: getPercentile(data.latencies, 95),
    };
  }

  console.log(`\n\n✅ Tier [${stage.name}] Completed:`);
  console.log(`   Duration      : ${totalTimeSec}s`);
  console.log(`   Throughput    : ${throughput} Req/s`);
  console.log(`   Success Rate  : ${(100 - errorRate).toFixed(2)}% (${stats.successful.toLocaleString()}/${stats.completed.toLocaleString()})`);
  console.log(`   Latency (p50) : ${p50}ms | (p95): ${p95}ms | (p99): ${p99}ms`);
  console.log(`   Status Codes  : ${JSON.stringify(stats.statusCodes)}`);

  return {
    test_name: stage.name,
    concurrent_workers: stage.workers,
    total_requests: stats.completed,
    successful_requests: stats.successful,
    failed_requests: stats.failed,
    error_rate_percent: errorRate,
    duration_seconds: totalTimeSec,
    throughput_rps: throughput,
    latency_metrics_ms: {
      min: minLatency,
      avg: avgLatency,
      p50: p50,
      p90: p90,
      p95: p95,
      p99: p99,
      max: maxLatency
    },
    status_codes: stats.statusCodes,
    endpoints: endpointSummary
  };
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║        NEXUS HIGH-STRESS & OVERLOAD BENCHMARK SUITE               ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log(` Target Service : ${API_URL}`);
  console.log(` Tiers          : 500 → 1,000 → 2,000 → 3,500 → 5,000 Workers`);
  console.log(` Total Requests : ${TEST_PLAN.reduce((acc, s) => acc + s.requests, 0).toLocaleString()} total requests`);
  console.log(` Output File    : ${OUTPUT_FILE}`);

  const results = {
    timestamp: new Date().toISOString(),
    target_url: API_URL,
    summary: [],
    stages: []
  };

  for (let i = 0; i < TEST_PLAN.length; i++) {
    const stage = TEST_PLAN[i];
    const stageResult = await runSingleStage(stage);
    results.stages.push(stageResult);
    results.summary.push({
      test: stage.name,
      concurrent_workers: stage.workers,
      requests: stage.requests,
      duration_sec: stageResult.duration_seconds,
      throughput_rps: stageResult.throughput_rps,
      success_rate_pct: (100 - stageResult.error_rate_percent).toFixed(2),
      p50_latency_ms: stageResult.latency_metrics_ms.p50,
      p95_latency_ms: stageResult.latency_metrics_ms.p95,
      p99_latency_ms: stageResult.latency_metrics_ms.p99,
    });

    // Write to both result files
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    fs.writeFileSync(HIGH_STRESS_OUTPUT_FILE, JSON.stringify(results, null, 2));

    if (i < TEST_PLAN.length - 1) {
      console.log(`\n⏳ Cooling down for 5 seconds before next high-load tier...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('               HIGH-STRESS BENCHMARK SUITE COMPLETED               ');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.table(results.summary);
  console.log(`\n📁 Complete JSON benchmark report written to:\n${OUTPUT_FILE}\n`);
}

main().catch(console.error);
