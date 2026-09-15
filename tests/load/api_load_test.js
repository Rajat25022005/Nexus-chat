#!/usr/bin/env node
/**
 * ==============================================================================
 * Nexus API — Concurrency & Throughput Load Test Harness
 * ==============================================================================
 *
 * Configurable parameters via environment variables:
 *   API_URL   : Target base URL (default: http://localhost:8080)
 *   USERS     : Concurrent worker count (default: 100)
 *   DURATION  : Test duration in seconds (default: 15)
 *   RAMP      : Warmup ramp-up time in seconds (default: 3)
 *
 * Usage:
 *   node tests/load/api_load_test.js
 *   USERS=500 DURATION=20 RAMP=5 node tests/load/api_load_test.js
 */

import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

const API_URL = process.env.API_URL || 'http://localhost:8080';
const USERS = parseInt(process.env.USERS || '100', 10);
const DURATION = parseInt(process.env.DURATION || '15', 10);
const RAMP = parseInt(process.env.RAMP || '3', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret-dev-key';

const targetUrl = new URL(API_URL);
const isHttps = targetUrl.protocol === 'https:';
const clientModule = isHttps ? https : http;

// Generate test HS256 JWT
function generateTestToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      user_id: '00000000-0000-0000-0000-000000000001',
      email: 'loadtest@nexus.local',
      iss: 'nexus-api',
      iat: now,
      exp: now + 7200,
    })
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

const testToken = generateTestToken();

const endpoints = [
  { path: '/healthz', method: 'GET', auth: false, weight: 4 },
  { path: '/ready', method: 'GET', auth: false, weight: 3 },
  { path: '/live', method: 'GET', auth: false, weight: 2 },
  { path: '/metrics/runtime', method: 'GET', auth: false, weight: 1 },
];

function getRandomEndpoint() {
  const totalWeight = endpoints.reduce((sum, e) => sum + e.weight, 0);
  let r = Math.random() * totalWeight;
  for (const ep of endpoints) {
    if (r < ep.weight) return ep;
    r -= ep.weight;
  }
  return endpoints[0];
}

const agent = new clientModule.Agent({
  keepAlive: true,
  maxSockets: USERS + 50,
  keepAliveMsecs: 30000,
});

function calculatePercentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
  return sorted[index];
}

async function runLoadTest() {
  console.log('='.repeat(70));
  console.log('🚀 NEXUS API LOAD TEST');
  console.log('='.repeat(70));
  console.log(`Target URL : ${API_URL}`);
  console.log(`Concurrency: ${USERS} workers`);
  console.log(`Duration   : ${DURATION}s (Ramp-up: ${RAMP}s)`);
  console.log('='.repeat(70));

  const latencies = [];
  let totalRequests = 0;
  let successfulRequests = 0;
  let failedRequests = 0;
  let isRunning = true;

  const testStartTime = performance.now();
  const testEndTime = testStartTime + DURATION * 1000;

  function makeRequest() {
    if (!isRunning && performance.now() >= testEndTime) {
      return;
    }

    const ep = getRandomEndpoint();
    const reqHeaders = {
      Accept: 'application/json',
      Connection: 'keep-alive',
    };
    if (ep.auth) {
      reqHeaders.Authorization = `Bearer ${testToken}`;
    }

    const reqOptions = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: ep.path,
      method: ep.method,
      agent: agent,
      headers: reqHeaders,
      timeout: 5000,
    };

    const startTime = performance.now();
    totalRequests++;

    const req = clientModule.request(reqOptions, (res) => {
      res.on('data', () => {});
      res.on('end', () => {
        const latency = performance.now() - startTime;
        latencies.push(latency);
        if (res.statusCode >= 200 && res.statusCode < 400) {
          successfulRequests++;
        } else {
          failedRequests++;
        }
        if (isRunning) {
          setImmediate(makeRequest);
        }
      });
    });

    req.on('error', () => {
      failedRequests++;
      if (isRunning) {
        setTimeout(makeRequest, 100);
      }
    });

    req.on('timeout', () => {
      req.destroy();
      failedRequests++;
      if (isRunning) {
        setTimeout(makeRequest, 100);
      }
    });

    req.end();
  }

  // Ramp-up workers
  const intervalPerWorker = (RAMP * 1000) / USERS;
  for (let i = 0; i < USERS; i++) {
    setTimeout(makeRequest, i * intervalPerWorker);
  }

  // Monitor progress
  const progressInterval = setInterval(() => {
    const elapsed = ((performance.now() - testStartTime) / 1000).toFixed(1);
    const rps = (successfulRequests / Math.max(elapsed, 1)).toFixed(1);
    process.stdout.write(
      `\r⏳ [${elapsed}s/${DURATION}s] Completed: ${totalRequests.toLocaleString()} | Success: ${successfulRequests.toLocaleString()} | Errors: ${failedRequests} | Current RPS: ${rps}`
    );
  }, 1000);

  await new Promise((resolve) => setTimeout(resolve, DURATION * 1000));
  isRunning = false;
  clearInterval(progressInterval);
  console.log('\n\n⏳ Finalizing pending connections...');

  // Allow drain
  await new Promise((resolve) => setTimeout(resolve, 1500));
  agent.destroy();

  const totalElapsedSec = (performance.now() - testStartTime) / 1000;
  latencies.sort((a, b) => a - b);

  const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  const p50 = calculatePercentile(latencies, 50);
  const p90 = calculatePercentile(latencies, 90);
  const p95 = calculatePercentile(latencies, 95);
  const p99 = calculatePercentile(latencies, 99);
  const throughput = (successfulRequests / totalElapsedSec).toFixed(2);
  const errorRate = totalRequests > 0 ? ((failedRequests / totalRequests) * 100).toFixed(2) : '0.00';

  console.log('\n' + '='.repeat(70));
  console.log('📊 LOAD TEST SCORECARD');
  console.log('='.repeat(70));
  console.log(`Total Requests Sent : ${totalRequests.toLocaleString()}`);
  console.log(`Successful Requests : ${successfulRequests.toLocaleString()} (${(100 - parseFloat(errorRate)).toFixed(2)}%)`);
  console.log(`Failed Requests     : ${failedRequests.toLocaleString()} (${errorRate}%)`);
  console.log(`Duration Elapsed    : ${totalElapsedSec.toFixed(2)}s`);
  console.log(`Avg Throughput (RPS): ${throughput} req/sec`);
  console.log('-'.repeat(70));
  console.log(`Average Latency     : ${avgLatency.toFixed(2)} ms`);
  console.log(`p50 Latency (Median): ${p50.toFixed(2)} ms`);
  console.log(`p90 Latency         : ${p90.toFixed(2)} ms`);
  console.log(`p95 Latency         : ${p95.toFixed(2)} ms`);
  console.log(`p99 Latency (Tail)  : ${p99.toFixed(2)} ms`);
  console.log('='.repeat(70));

  if (failedRequests > totalRequests * 0.05) {
    console.log('❌ Result: FAILED (Error rate exceeded 5% threshold)\n');
    process.exit(1);
  } else {
    console.log('✅ Result: PASSED (System healthy under load)\n');
    process.exit(0);
  }
}

runLoadTest().catch((err) => {
  console.error('Fatal load test error:', err);
  process.exit(1);
});
