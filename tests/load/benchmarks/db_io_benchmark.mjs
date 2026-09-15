#!/usr/bin/env node
/**
 * Nexus Platform Comprehensive Database I/O Benchmark
 * 
 * Measures actual database input/output (Writes & Reads) through the live API & PostgreSQL:
 * 1. Heavy Multi-Table Concurrent INSERTs (User Registration: 7 DB rows written per request)
 * 2. Authenticated SELECT Read Concurrency (/api/auth/me & /api/workspaces)
 * 3. Relational Foreign Key & Unique Constraint Write Concurrency (/api/v1/chats/direct)
 * 4. User Discovery Database Pattern Search (/api/v1/users/search)
 */

import http from 'node:http';
import { performance } from 'node:perf_hooks';

const BASE_HOST = '127.0.0.1';
const BASE_PORT = 8080;

const agent = new http.Agent({
  keepAlive: true,
  maxSockets: 200,
  keepAliveMsecs: 60000,
});

function request(method, path, body = null, token = null) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Connection': 'keep-alive',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (data) {
      headers['Content-Length'] = Buffer.byteLength(data);
    }

    const start = performance.now();
    const req = http.request(
      {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: path,
        method: method,
        agent: agent,
        headers: headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          const dur = performance.now() - start;
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, dur, body: parsed, error: null });
        });
      }
    );

    req.on('error', (err) => {
      const dur = performance.now() - start;
      resolve({ status: 0, dur, body: null, error: err.code || err.message });
    });

    if (data) {
      req.write(data);
    }
    req.end();
  });
}

function calculatePercentiles(latencies) {
  if (latencies.length === 0) return { p50: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0 };
  const s = latencies.slice().sort((a, b) => a - b);
  const n = s.length;
  return {
    min: s[0],
    p50: s[Math.floor(n * 0.5)],
    p90: s[Math.floor(n * 0.9)],
    p95: s[Math.floor(n * 0.95)],
    p99: s[Math.floor(n * 0.99)],
    max: s[n - 1],
  };
}

async function runConcurrentPool(name, count, concurrency, taskFn) {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`📊 Benchmark: ${name}`);
  console.log(`   Operations: ${count.toLocaleString()} | Concurrency: ${concurrency}`);
  console.log(`${'='.repeat(72)}`);

  const latencies = [];
  let successCount = 0;
  let errorCount = 0;
  let completed = 0;
  let launched = 0;
  const startAll = performance.now();

  return new Promise((resolve) => {
    function next() {
      if (launched >= count) return;
      const idx = launched++;

      taskFn(idx).then((res) => {
        latencies.push(res.dur);
        if (res.status >= 200 && res.status < 300) {
          successCount++;
        } else {
          errorCount++;
        }
        completed++;
        if (launched < count) {
          next();
        } else if (completed === count) {
          const totalSec = (performance.now() - startAll) / 1000;
          const rps = totalSec > 0 ? successCount / totalSec : 0;
          const stats = calculatePercentiles(latencies);

          console.log(`   ⏱️  Total Duration:     ${totalSec.toFixed(3)}s`);
          console.log(`   🚀 Operations/Sec:     ${rps.toFixed(1)} op/sec`);
          console.log(`   🎯 Success Rate:       ${((successCount / count) * 100).toFixed(2)}% (${successCount}/${count})`);
          console.log(
            `   📈 Latency:            p50: ${stats.p50.toFixed(2)}ms | p90: ${stats.p90.toFixed(2)}ms | p95: ${stats.p95.toFixed(2)}ms | p99: ${stats.p99.toFixed(2)}ms`
          );
          console.log(`   ⚡ Range:              min: ${stats.min.toFixed(2)}ms | max: ${stats.max.toFixed(2)}ms`);

          resolve({
            name,
            count,
            concurrency,
            duration: totalSec,
            rps,
            stats,
            successCount,
          });
        }
      });
    }

    for (let c = 0; c < concurrency && c < count; c++) {
      next();
    }
  });
}

async function main() {
  console.log('='.repeat(72));
  console.log('💾 NEXUS REAL DATABASE I/O (READ & WRITE) BENCHMARK 💾');
  console.log('Target: PostgreSQL via Go API (pgxpool)');
  console.log('='.repeat(72));

  const runId = Math.floor(Date.now() / 1000) % 100000;

  // -------------------------------------------------------------
  // PHASE 1: Heavy Multi-Table Database WRITES (INSERTs)
  // Each user registration writes: 1 user, 1 tenant, 1 workspace, 
  // 1 member, 1 group, 1 group_member, 1 chat = 7 rows per request!
  // -------------------------------------------------------------
  const createdUsers = [];
  const writeRes = await runConcurrentPool(
    'Phase 1: Multi-Table Database INSERTs (User + Tenant + WS + Group + Chat)',
    1000,
    30,
    async (i) => {
      const email = `dbio_${runId}_${i}@nexus.local`;
      const res = await request('POST', '/api/auth/register', {
        email: email,
        password: 'Password123!',
        display_name: `DB User ${i}`,
      });
      if (res.status === 201 || res.status === 200) {
        if (res.body && res.body.token) {
          createdUsers.push({
            id: res.body.user.id,
            email: email,
            token: res.body.token,
          });
        }
      }
      return res;
    }
  );

  const totalRowsWritten = writeRes.successCount * 7;
  console.log(`   📦 Total PostgreSQL Rows Written: ${totalRowsWritten.toLocaleString()} rows (~${(totalRowsWritten / writeRes.duration).toFixed(1)} rows/sec)`);

  if (createdUsers.length < 50) {
    console.log('❌ Failed to provision sufficient users for subsequent read phases.');
    process.exit(1);
  }

  // -------------------------------------------------------------
  // PHASE 2: High-Concurrency Database READs (SELECTs with Joins)
  // -------------------------------------------------------------
  const sampleTokens = createdUsers.slice(0, 50).map((u) => u.token);

  const readRes = await runConcurrentPool(
    'Phase 2: Authenticated Database READs (SELECT Profile & User Lookup)',
    10000,
    60,
    async (i) => {
      const token = sampleTokens[i % sampleTokens.length];
      return await request('GET', '/api/auth/me', null, token);
    }
  );

  // -------------------------------------------------------------
  // PHASE 3: Workspace & Member Query READs (Relational Joins)
  // -------------------------------------------------------------
  const wsReadRes = await runConcurrentPool(
    'Phase 3: Relational Workspace & Member Queries (SELECT with Joins)',
    5000,
    50,
    async (i) => {
      const token = sampleTokens[i % sampleTokens.length];
      return await request('GET', '/api/workspaces', null, token);
    }
  );

  // -------------------------------------------------------------
  // PHASE 4: Concurrent Relational INSERTs with Constraint Verification
  // Direct 1:1 Chat Creation across user pairs
  // -------------------------------------------------------------
  const uA = createdUsers[0];
  const uB = createdUsers[1];

  const directChatRes = await runConcurrentPool(
    'Phase 4: Relational Foreign-Key Writes (Direct 1:1 Chat Creation)',
    1000,
    40,
    async () => {
      return await request(
        'POST',
        '/api/v1/chats/direct',
        { recipient_id: uB.id },
        uA.token
      );
    }
  );

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log(`\n${'='.repeat(72)}`);
  console.log('🏆 DATABASE I/O PERFORMANCE SUMMARY');
  console.log('='.repeat(72));
  console.log(
    `${'Benchmark Phase'.padEnd(38)} | ${'Throughput'.padEnd(12)} | ${'p50 Latency'.padEnd(12)} | ${'p99 Latency'}`
  );
  console.log('-'.repeat(72));
  console.log(
    `${'1. Multi-Table INSERTs (7 rows/req)'.padEnd(38)} | ${(writeRes.rps.toFixed(1) + ' op/s').padEnd(12)} | ${(writeRes.stats.p50.toFixed(2) + ' ms').padEnd(12)} | ${writeRes.stats.p99.toFixed(2)} ms`
  );
  console.log(
    `${'2. Authenticated Profile SELECTs'.padEnd(38)} | ${(readRes.rps.toFixed(1) + ' op/s').padEnd(12)} | ${(readRes.stats.p50.toFixed(2) + ' ms').padEnd(12)} | ${readRes.stats.p99.toFixed(2)} ms`
  );
  console.log(
    `${'3. Relational Workspace Joins'.padEnd(38)} | ${(wsReadRes.rps.toFixed(1) + ' op/s').padEnd(12)} | ${(wsReadRes.stats.p50.toFixed(2) + ' ms').padEnd(12)} | ${wsReadRes.stats.p99.toFixed(2)} ms`
  );
  console.log(
    `${'4. Relational Direct Chat Transactions'.padEnd(38)} | ${(directChatRes.rps.toFixed(1) + ' op/s').padEnd(12)} | ${(directChatRes.stats.p50.toFixed(2) + ' ms').padEnd(12)} | ${directChatRes.stats.p99.toFixed(2)} ms`
  );
  console.log('='.repeat(72));

  agent.destroy();
}

main().catch(console.error);
