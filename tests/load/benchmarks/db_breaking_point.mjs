#!/usr/bin/env node
/**
 * PostgreSQL Read & Write Breaking Point Stress Test
 * Ramps up concurrent database operations through Go pgxpool until hardware/pool saturation.
 *
 * Part 1: Database Reads to Breaking Point (SELECTs with JWT Auth & pgxpool)
 * Part 2: Database Writes to Breaking Point (UPDATEs & INSERTs with PostgreSQL WAL commits)
 */

import http from 'node:http';
import { performance } from 'node:perf_hooks';

const BASE_HOST = '127.0.0.1';
const BASE_PORT = 8080;

const agent = new http.Agent({
  keepAlive: true,
  maxSockets: 2500,
  keepAliveMsecs: 60000,
});

function httpRequest(method, path, body = null, token = null) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Connection': 'keep-alive',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

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
        res.on('data', (chunk) => (raw += chunk));
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
      resolve({ status: 0, dur: performance.now() - start, body: null, error: err.code || err.message });
    });

    if (data) req.write(data);
    req.end();
  });
}

function calculatePercentiles(latencies, count) {
  if (count === 0) return { p50: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0 };
  const valid = latencies.subarray(0, count).sort();
  return {
    min: valid[0] / 100,
    p50: valid[Math.floor(count * 0.5)] / 100,
    p90: valid[Math.floor(count * 0.9)] / 100,
    p95: valid[Math.floor(count * 0.95)] / 100,
    p99: valid[Math.floor(count * 0.99)] / 100,
    max: valid[count - 1] / 100,
  };
}

async function runStage(title, totalReqs, concurrency, taskFn) {
  console.log(`\n${'='.repeat(74)}`);
  console.log(`⚡ ${title}`);
  console.log(`   Operations: ${totalReqs.toLocaleString()} | Concurrency: ${concurrency.toLocaleString()} workers`);
  console.log(`${'='.repeat(74)}`);

  const latencies = new Uint32Array(totalReqs);
  const errorMap = {};
  let successCount = 0;
  let errorCount = 0;
  let completed = 0;
  let launched = 0;

  const startAll = performance.now();

  return new Promise((resolve) => {
    function fire(wId) {
      if (launched >= totalReqs) return;
      const curIdx = launched++;

      taskFn(curIdx).then((res) => {
        if (curIdx < totalReqs) {
          latencies[curIdx] = Math.min(Math.round(res.dur * 100), 4294967295);
        }

        if (res.status >= 200 && res.status < 300) {
          successCount++;
        } else {
          errorCount++;
          const code = `HTTP_${res.status}`;
          errorMap[code] = (errorMap[code] || 0) + 1;
        }

        completed++;
        if (launched < totalReqs) {
          fire(wId);
        } else if (completed === totalReqs) {
          finish();
        }
      });
    }

    // Micro-stagger initial workers to prevent SYN backlog congestion
    const batchSize = Math.min(100, concurrency);
    let launchedWorkers = 0;
    const rampTimer = setInterval(() => {
      const end = Math.min(launchedWorkers + batchSize, concurrency, totalReqs);
      for (; launchedWorkers < end; launchedWorkers++) {
        fire(launchedWorkers);
      }
      if (launchedWorkers >= concurrency || launchedWorkers >= totalReqs) {
        clearInterval(rampTimer);
      }
    }, 10);

    function finish() {
      const totalSec = (performance.now() - startAll) / 1000;
      const rps = totalSec > 0 ? successCount / totalSec : 0;
      const stats = calculatePercentiles(latencies, completed);
      const successRate = (successCount / (completed || 1)) * 100;

      console.log(`   ⏱️  Total Duration:     ${totalSec.toFixed(3)}s`);
      console.log(`   🚀 Operations/Sec:     ${rps.toFixed(1)} op/sec`);
      console.log(`   🎯 Success Rate:       ${successRate.toFixed(2)}% (${successCount.toLocaleString()}/${completed.toLocaleString()})`);
      console.log(`   📈 Latency:            p50: ${stats.p50.toFixed(2)}ms | p90: ${stats.p90.toFixed(2)}ms | p95: ${stats.p95.toFixed(2)}ms | p99: ${stats.p99.toFixed(2)}ms`);
      console.log(`   ⚡ Range:              min: ${stats.min.toFixed(2)}ms | max: ${stats.max.toFixed(2)}ms`);
      if (Object.keys(errorMap).length > 0) {
        console.log(`   ⚠️  Errors:             ${JSON.stringify(errorMap)}`);
      }

      const saturated = stats.p50 > 1000 || successRate < 90;
      resolve({
        title,
        concurrency,
        totalReqs,
        rps,
        successRate,
        stats,
        saturated,
      });
    }
  });
}

async function main() {
  console.log('='.repeat(76));
  console.log('💥 POSTGRESQL READ & WRITE BREAKING POINT BENCHMARK 💥');
  console.log('Target: PostgreSQL via Go API pgxpool (Port 8080)');
  console.log('='.repeat(76));

  // Setup: Provision 20 test accounts for distributed database traffic
  console.log('\n[Setup] Provisioning 20 benchmark accounts...');
  const users = [];
  const runId = Math.floor(Date.now() / 1000) % 100000;

  for (let i = 0; i < 20; i++) {
    const email = `db_stress_${runId}_${i}@nexus.local`;
    const res = await httpRequest('POST', '/api/auth/register', {
      email: email,
      password: 'BenchmarkPass123!',
      display_name: `DB Tester ${i}`,
    });
    if (res.status === 201 || res.status === 200) {
      users.push({
        id: res.body.user.id,
        email: email,
        token: res.body.token,
      });
    }
  }
  console.log(`✅ Provisioned ${users.length} benchmark users in PostgreSQL.`);

  // =============================================================
  // PART 1: DATABASE READS TO BREAKING POINT
  // SELECT query with JWT auth: SELECT * FROM users WHERE id = $1
  // =============================================================
  console.log('\n' + '#'.repeat(76));
  console.log('📖 PART 1: POSTGRESQL READS TO BREAKING POINT (SELECT / PROFILE)');
  console.log('#'.repeat(76));

  const readTiers = [
    { concurrency: 50, requests: 10000 },
    { concurrency: 100, requests: 20000 },
    { concurrency: 250, requests: 25000 },
    { concurrency: 500, requests: 50000 },
    { concurrency: 1000, requests: 50000 },
    { concurrency: 2000, requests: 50000 },
  ];

  const readResults = [];
  for (let i = 0; i < readTiers.length; i++) {
    const tier = readTiers[i];
    const res = await runStage(
      `Read Tier ${i + 1}: ${tier.concurrency} Workers (SELECT)`,
      tier.requests,
      tier.concurrency,
      (idx) => {
        const user = users[idx % users.length];
        return httpRequest('GET', '/api/auth/me', null, user.token);
      }
    );
    readResults.push(res);
    await new Promise((r) => setTimeout(r, 1000));
  }

  // =============================================================
  // PART 2: DATABASE WRITES TO BREAKING POINT
  // UPDATE query with disk WAL commit: UPDATE users SET display_name = ... WHERE id = $1
  // =============================================================
  console.log('\n' + '#'.repeat(76));
  console.log('✍️  PART 2: POSTGRESQL WRITES TO BREAKING POINT (UPDATE / WAL FLUSH)');
  console.log('#'.repeat(76));

  const writeTiers = [
    { concurrency: 25, requests: 2500 },
    { concurrency: 50, requests: 5000 },
    { concurrency: 100, requests: 10000 },
    { concurrency: 250, requests: 15000 },
    { concurrency: 500, requests: 20000 },
  ];

  const writeResults = [];
  for (let i = 0; i < writeTiers.length; i++) {
    const tier = writeTiers[i];
    const res = await runStage(
      `Write Tier ${i + 1}: ${tier.concurrency} Workers (UPDATE & WAL Commit)`,
      tier.requests,
      tier.concurrency,
      (idx) => {
        const user = users[idx % users.length];
        return httpRequest(
          'PUT',
          '/api/auth/profile',
          { display_name: `Updated User ${idx % 1000}` },
          user.token
        );
      }
    );
    writeResults.push(res);
    await new Promise((r) => setTimeout(r, 1000));
  }

  // =============================================================
  // GRAND SUMMARY SCORECARD
  // =============================================================
  console.log(`\n${'='.repeat(76)}`);
  console.log('🏆 POSTGRESQL READ BREAKING POINT PERFORMANCE MATRIX');
  console.log('='.repeat(76));
  console.log(
    `${'Workers'.padEnd(10)} | ${'Queries'.padEnd(10)} | ${'Throughput'.padEnd(14)} | ${'Success'.padEnd(8)} | ${'p50'.padEnd(8)} | ${'p95'.padEnd(8)} | ${'p99'}`
  );
  console.log('-'.repeat(76));
  for (const r of readResults) {
    console.log(
      `${r.concurrency.toString().padEnd(10)} | ${r.totalReqs.toLocaleString().padEnd(10)} | ${(r.rps.toFixed(1) + ' QPS').padEnd(14)} | ${(r.successRate.toFixed(1) + '%').padEnd(8)} | ${(r.stats.p50.toFixed(2) + 'ms').padEnd(8)} | ${(r.stats.p95.toFixed(2) + 'ms').padEnd(8)} | ${r.stats.p99.toFixed(2)}ms`
    );
  }

  console.log(`\n${'='.repeat(76)}`);
  console.log('🏆 POSTGRESQL WRITE BREAKING POINT PERFORMANCE MATRIX');
  console.log('='.repeat(76));
  console.log(
    `${'Workers'.padEnd(10)} | ${'Writes'.padEnd(10)} | ${'Throughput'.padEnd(14)} | ${'Success'.padEnd(8)} | ${'p50'.padEnd(8)} | ${'p95'.padEnd(8)} | ${'p99'}`
  );
  console.log('-'.repeat(76));
  for (const r of writeResults) {
    console.log(
      `${r.concurrency.toString().padEnd(10)} | ${r.totalReqs.toLocaleString().padEnd(10)} | ${(r.rps.toFixed(1) + ' TPS').padEnd(14)} | ${(r.successRate.toFixed(1) + '%').padEnd(8)} | ${(r.stats.p50.toFixed(2) + 'ms').padEnd(8)} | ${(r.stats.p95.toFixed(2) + 'ms').padEnd(8)} | ${r.stats.p99.toFixed(2)}ms`
    );
  }
  console.log('='.repeat(76));

  agent.destroy();
}

main().catch(console.error);
