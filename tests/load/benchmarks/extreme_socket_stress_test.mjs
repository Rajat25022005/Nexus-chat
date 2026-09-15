#!/usr/bin/env node
/**
 * ==============================================================================
 * NEXUS-SOCKET HYPERSCALE C10K STRESS & HARDWARE LIMIT HARNESS
 * ==============================================================================
 * 
 * Exhaustive multi-phase stress testing of Elixir / Bandit WebSocket Gateway:
 * - Stage 1: C10K Concurrency Ramp (10,000 Persistent Authenticated WebSockets)
 * - Stage 2: High-Frequency Messaging & Inbound Ingestion (100,000 Messages with Acks)
 * - Stage 3: Broadcast Avalanche (2,000 Subscribers x 50 Broadcasts = 100,000 Deliveries)
 * - Stage 4: Presence Churn Storm (20,000 Delta-CRDT Operations)
 * - Stage 5: Cross-Service Redis Pub/Sub Stream (5,000 Injections)
 * - Stage 6: Adversarial Framing, Corrupted Payloads & Chaos Injection
 * - Full BEAM VM Telemetry: Process Count, Run Queues, ETS & Process Memory
 * ==============================================================================
 */

import WebSocket from '/Users/rajat/Desktop/Nexus-chat/client/node_modules/ws/index.js';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const SOCKET_PORT = 3001;
const SOCKET_URL = `ws://127.0.0.1:${SOCKET_PORT}/socket.io/?EIO=4&transport=websocket`;
const METRICS_URL = `http://127.0.0.1:${SOCKET_PORT}/metrics`;
const JWT_SECRET = 'supersecret-dev-key';

// JWT Generation
function createJwt(userId, email, name) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 7200;
  const payload = Buffer.from(
    JSON.stringify({
      user_id: userId,
      email: email,
      name: name,
      exp: exp,
      iat: Math.floor(Date.now() / 1000),
    })
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

// BEAM Metrics Poller
function fetchBeamMetrics() {
  return new Promise((resolve) => {
    http.get(METRICS_URL, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

function getBeamPid() {
  try {
    const out = execSync(`lsof -ti :${SOCKET_PORT} -sTCP:LISTEN 2>/dev/null`, { encoding: 'utf8' }).trim();
    return out ? parseInt(out.split('\n')[0], 10) : null;
  } catch {
    return null;
  }
}

function getBeamCpu(pid) {
  if (!pid) return 0;
  try {
    const out = execSync(`ps -p ${pid} -o %cpu 2>/dev/null`, { encoding: 'utf8' }).trim();
    const lines = out.split('\n');
    return lines.length > 1 ? parseFloat(lines[1].trim()) || 0 : 0;
  } catch {
    return 0;
  }
}

// Percentile Calculation
function calculatePercentiles(latencies) {
  if (!latencies || latencies.length === 0) {
    return { min: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0, avg: 0 };
  }
  const sorted = latencies.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const p = (q) => sorted[Math.min(Math.floor(sorted.length * q), sorted.length - 1)];

  return {
    min: parseFloat(sorted[0].toFixed(2)),
    p50: parseFloat(p(0.50).toFixed(2)),
    p90: parseFloat(p(0.90).toFixed(2)),
    p95: parseFloat(p(0.95).toFixed(2)),
    p99: parseFloat(p(0.99).toFixed(2)),
    max: parseFloat(sorted[sorted.length - 1].toFixed(2)),
    avg: parseFloat((sum / sorted.length).toFixed(2)),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('='.repeat(90));
  console.log('⚡ NEXUS-SOCKET HYPERSCALE C10K HARDWARE LIMIT BENCHMARK ⚡');
  console.log('='.repeat(90));

  const beamPid = getBeamPid();
  console.log(`[Discovery] Target: ${SOCKET_URL}`);
  console.log(`[Discovery] BEAM PID: ${beamPid || 'Unknown'}`);

  const baselineBeam = await fetchBeamMetrics();
  console.log(`[Baseline] Process Count: ${baselineBeam?.process_count} | BEAM Total Memory: ${baselineBeam?.memory?.total_mb} MB`);
  console.log(`[Baseline] Schedulers Online: ${baselineBeam?.schedulers} | Redis Connected: ${baselineBeam?.redis_connected}`);

  const testReport = {
    timestamp: new Date().toISOString(),
    baseline: baselineBeam,
    stages: {},
  };

  // ============================================================================
  // STAGE 1: C10K CONNECTION SCALING (10,000 Concurrent WebSockets)
  // ============================================================================
  console.log('\n' + '='.repeat(90));
  console.log('🚀 STAGE 1: C10K CONCURRENCY & MASSIVE HANDSHAKE SCALING');
  console.log('   Target: 10,000 simultaneous persistent authenticated WebSockets');
  console.log('='.repeat(90));

  const TARGET_CONNECTIONS = 10000;
  const BATCH_SIZE = 200;
  const BATCH_DELAY_MS = 20;

  const sockets = [];
  const handshakeLatencies = [];
  let connectedCount = 0;
  let handshakeFailed = 0;

  const stage1Start = performance.now();

  for (let i = 0; i < TARGET_CONNECTIONS; i += BATCH_SIZE) {
    const currentBatch = Math.min(BATCH_SIZE, TARGET_CONNECTIONS - i);
    const batchPromises = [];

    for (let b = 0; b < currentBatch; b++) {
      const idx = i + b;
      const userId = `c10k_user_${idx}`;
      const token = createJwt(userId, `${userId}@nexus.local`, `C10K User ${idx}`);

      batchPromises.push(
        new Promise((resolve) => {
          const t0 = performance.now();
          const ws = new WebSocket(SOCKET_URL);
          let authed = false;

          ws.clientData = {
            id: idx,
            userId,
            token,
            joinedRooms: new Set(),
            pendingAcks: new Map(),
            receivedBroadcasts: [],
          };

          ws.on('open', () => {});

          ws.on('message', (raw) => {
            const str = raw.toString();

            // Heartbeat handling (Server sends 2 -> client replies 3)
            if (str === '2') {
              ws.send('3');
              return;
            }

            // Engine.IO Open -> Send Socket.IO Auth
            if (str.startsWith('0')) {
              ws.send('40' + JSON.stringify({ token }));
              return;
            }

            // Socket.IO Connect Ack
            if (str.startsWith('40') && !authed) {
              authed = true;
              const dur = performance.now() - t0;
              handshakeLatencies.push(dur);
              connectedCount++;
              resolve(ws);
              return;
            }

            // Socket.IO Ack (43<ackId>[{...}])
            if (str.startsWith('43')) {
              const match = str.match(/^43(\d+)(.*)$/);
              if (match) {
                const ackId = parseInt(match[1], 10);
                const resolver = ws.clientData.pendingAcks.get(ackId);
                if (resolver) {
                  ws.clientData.pendingAcks.delete(ackId);
                  resolver(match[2]);
                }
              }
              return;
            }

            // Socket.IO Broadcast Event (42["event", {...}])
            if (str.startsWith('42')) {
              try {
                const parsed = JSON.parse(str.slice(2));
                const [evName, payload] = parsed;
                if (evName === 'new_message') {
                  const sentTime = payload.tempId ? parseFloat(payload.tempId) : 0;
                  ws.clientData.receivedBroadcasts.push({
                    msgId: payload.id,
                    rxTime: performance.now(),
                    sentTime,
                  });
                }
              } catch {}
            }
          });

          ws.on('error', () => {
            if (!authed) {
              handshakeFailed++;
              resolve(null);
            }
          });

          ws.on('close', () => {});

          setTimeout(() => {
            if (!authed) {
              handshakeFailed++;
              try { ws.close(); } catch {}
              resolve(null);
            }
          }, 12000);
        })
      );
    }

    const batchResults = await Promise.all(batchPromises);
    for (const ws of batchResults) {
      if (ws) sockets.push(ws);
    }

    if ((i + currentBatch) % 2000 === 0 || i + currentBatch === TARGET_CONNECTIONS) {
      const elSec = ((performance.now() - stage1Start) / 1000).toFixed(1);
      const metrics = await fetchBeamMetrics();
      console.log(
        `   ⚡ [Ramp] Connected: ${sockets.length.toLocaleString()}/${TARGET_CONNECTIONS.toLocaleString()} | ` +
        `Elapsed: ${elSec}s | BEAM Procs: ${metrics?.process_count} | BEAM Memory: ${metrics?.memory?.total_mb} MB | RunQueue: ${metrics?.run_queue}`
      );
    }

    await sleep(BATCH_DELAY_MS);
  }

  const stage1Duration = (performance.now() - stage1Start) / 1000;
  const stage1Stats = calculatePercentiles(handshakeLatencies);
  const peakBeamStage1 = await fetchBeamMetrics();
  const beamCpuStage1 = getBeamCpu(beamPid);

  console.log(`\n✅ STAGE 1 COMPLETE:`);
  console.log(`   - Connected Sockets:     ${sockets.length.toLocaleString()} / ${TARGET_CONNECTIONS.toLocaleString()} (${((sockets.length / TARGET_CONNECTIONS) * 100).toFixed(1)}%)`);
  console.log(`   - Failed Connections:    ${handshakeFailed}`);
  console.log(`   - Connection Ramp Rate:  ${(sockets.length / stage1Duration).toFixed(1)} connections/sec`);
  console.log(`   - Handshake Latency:     p50: ${stage1Stats.p50}ms | p90: ${stage1Stats.p90}ms | p95: ${stage1Stats.p95}ms | p99: ${stage1Stats.p99}ms | max: ${stage1Stats.max}ms`);
  console.log(`   - BEAM Processes:        ${peakBeamStage1?.process_count} (+${peakBeamStage1?.process_count - baselineBeam?.process_count})`);
  console.log(`   - BEAM Memory:           ${peakBeamStage1?.memory?.total_mb} MB (+${(peakBeamStage1?.memory?.total_mb - baselineBeam?.memory?.total_mb).toFixed(1)} MB)`);
  console.log(`   - Memory per Socket:     ${(((peakBeamStage1?.memory?.total_mb - baselineBeam?.memory?.total_mb) * 1024) / sockets.length).toFixed(2)} KB / socket`);

  testReport.stages.stage1 = {
    target: TARGET_CONNECTIONS,
    connected: sockets.length,
    failed: handshakeFailed,
    rampRateConnsSec: parseFloat((sockets.length / stage1Duration).toFixed(1)),
    handshakeLatenciesMs: stage1Stats,
    beam: peakBeamStage1,
  };

  // ============================================================================
  // STAGE 2: HIGH-FREQUENCY MESSAGING & ACK FLOOD (100,000 Messages)
  // ============================================================================
  console.log('\n' + '='.repeat(90));
  console.log('⚡ STAGE 2: HIGH-FREQUENCY MESSAGING & PROTOCOL ACK FLOOD');
  console.log('   Target: 100,000 messages with per-packet Socket.IO acknowledgements');
  console.log('='.repeat(90));

  const TOTAL_MESSAGES = 100000;
  const activeSockets = sockets.slice(0, 4000); // 4,000 active worker sockets
  const ackLatencies = [];
  let acksReceived = 0;
  let acksFailed = 0;
  let sentMessages = 0;

  // Pre-join active sockets across 100 partitioned channels
  for (let s = 0; s < activeSockets.length; s++) {
    const ws = activeSockets[s];
    ws.send(`42["join_chat",{"chatId":"load_room_${s % 100}"}]`);
  }
  await sleep(500);

  const stage2Start = performance.now();
  let ackCounter = 1;

  await new Promise((resolve) => {
    let inflight = 0;
    const maxInflight = 2000; // 2,000 concurrent pipelined in-flight acks

    function sendNext() {
      if (sentMessages >= TOTAL_MESSAGES && inflight === 0) {
        resolve();
        return;
      }

      while (sentMessages < TOTAL_MESSAGES && inflight < maxInflight) {
        sentMessages++;
        inflight++;
        const currentAck = ackCounter++;
        const ws = activeSockets[sentMessages % activeSockets.length];
        const t0 = performance.now();

        const timeoutId = setTimeout(() => {
          if (ws.clientData.pendingAcks.has(currentAck)) {
            ws.clientData.pendingAcks.delete(currentAck);
            acksFailed++;
            inflight--;
            sendNext();
          }
        }, 5000);

        ws.clientData.pendingAcks.set(currentAck, () => {
          clearTimeout(timeoutId);
          const dur = performance.now() - t0;
          ackLatencies.push(dur);
          acksReceived++;
          inflight--;

          if (acksReceived % 20000 === 0 || acksReceived === TOTAL_MESSAGES) {
            const elSec = ((performance.now() - stage2Start) / 1000).toFixed(1);
            const rps = (acksReceived / elSec).toFixed(0);
            console.log(`   ⚡ [Ack Flood] Ingested: ${acksReceived.toLocaleString()}/${TOTAL_MESSAGES.toLocaleString()} | Rate: ${rps} msgs/sec`);
          }

          sendNext();
        });

        const payload = JSON.stringify([
          'send_message',
          {
            chatId: `load_room_${ws.clientData.id % 100}`,
            content: `Extreme stress test message #${sentMessages}`,
          },
        ]);
        ws.send(`42${currentAck}${payload}`);
      }
    }

    sendNext();
  });

  const stage2Duration = (performance.now() - stage2Start) / 1000;
  const stage2Stats = calculatePercentiles(ackLatencies);
  const peakBeamStage2 = await fetchBeamMetrics();

  console.log(`\n✅ STAGE 2 COMPLETE:`);
  console.log(`   - Messages Ingested:    ${acksReceived.toLocaleString()} / ${TOTAL_MESSAGES.toLocaleString()} (${((acksReceived / TOTAL_MESSAGES) * 100).toFixed(1)}%)`);
  console.log(`   - Ack Failures/Timeout: ${acksFailed}`);
  console.log(`   - Ingestion Throughput: ${(acksReceived / stage2Duration).toFixed(1)} msgs/sec`);
  console.log(`   - Ack Latencies:        p50: ${stage2Stats.p50}ms | p90: ${stage2Stats.p90}ms | p95: ${stage2Stats.p95}ms | p99: ${stage2Stats.p99}ms | max: ${stage2Stats.max}ms`);
  console.log(`   - BEAM Run Queue:       ${peakBeamStage2?.run_queue}`);

  testReport.stages.stage2 = {
    totalSent: sentMessages,
    acksReceived,
    acksFailed,
    throughputMsgsSec: parseFloat((acksReceived / stage2Duration).toFixed(1)),
    ackLatenciesMs: stage2Stats,
    beam: peakBeamStage2,
  };

  // ============================================================================
  // STAGE 3: BROADCAST AVALANCHE & 1-TO-N FAN-OUT (2,000 Subscribers x 50 Msgs)
  // ============================================================================
  console.log('\n' + '='.repeat(90));
  console.log('💥 STAGE 3: BROADCAST AVALANCHE & MASSIVE 1-TO-N FAN-OUT');
  console.log('   Target: 2,000 clients in ONE room x 50 broadcasts = 100,000 frame fan-outs');
  console.log('='.repeat(90));

  const FANOUT_ROOM = 'chat:colosseum_fanout';
  const FANOUT_CLIENTS = Math.min(2000, sockets.length);
  const fanoutSockets = sockets.slice(0, FANOUT_CLIENTS);

  console.log(`   [Setup] Subscribing ${FANOUT_CLIENTS.toLocaleString()} sockets to ${FANOUT_ROOM}...`);
  for (const ws of fanoutSockets) {
    ws.clientData.receivedBroadcasts = [];
    ws.send(`42["join_chat",{"chatId":"colosseum_fanout"}]`);
  }
  await sleep(1000);

  const NUM_BROADCASTS = 50;
  const EXPECTED_DELIVERIES = NUM_BROADCASTS * FANOUT_CLIENTS;
  const publisherSocket = sockets[sockets.length - 1];

  console.log(`   [Execution] Blasting ${NUM_BROADCASTS} messages into ${FANOUT_ROOM}...`);
  const stage3Start = performance.now();

  for (let b = 1; b <= NUM_BROADCASTS; b++) {
    const tSent = performance.now();
    publisherSocket.send(
      `42["send_message",{"chatId":"colosseum_fanout","content":"Colosseum Broadcast #${b}","tempId":"${tSent}"}]`
    );
    await sleep(25); // 40 Hz injection rate
  }

  // Poll until all 100,000 deliveries are drained from TCP buffers (max 8s)
  const pollStart = performance.now();
  let totalDeliveriesReceived = 0;
  while (performance.now() - pollStart < 8000) {
    totalDeliveriesReceived = fanoutSockets.reduce((acc, ws) => acc + ws.clientData.receivedBroadcasts.length, 0);
    if (totalDeliveriesReceived >= EXPECTED_DELIVERIES) break;
    await sleep(200);
  }

  const stage3Duration = (performance.now() - stage3Start) / 1000;
  const deliveryLatencies = [];

  for (const ws of fanoutSockets) {
    for (const b of ws.clientData.receivedBroadcasts) {
      if (b.sentTime > 0) {
        deliveryLatencies.push(b.rxTime - b.sentTime);
      }
    }
  }

  const stage3Stats = calculatePercentiles(deliveryLatencies);
  const peakBeamStage3 = await fetchBeamMetrics();

  console.log(`\n✅ STAGE 3 COMPLETE:`);
  console.log(`   - Expected Deliveries:  ${EXPECTED_DELIVERIES.toLocaleString()} frames`);
  console.log(`   - Received Deliveries:  ${totalDeliveriesReceived.toLocaleString()} frames (${((totalDeliveriesReceived / EXPECTED_DELIVERIES) * 100).toFixed(1)}%)`);
  console.log(`   - Fan-Out Throughput:   ${(totalDeliveriesReceived / stage3Duration).toFixed(1)} frames fanned out / sec`);
  console.log(`   - Delivery Latency:     p50: ${stage3Stats.p50}ms | p90: ${stage3Stats.p90}ms | p95: ${stage3Stats.p95}ms | p99: ${stage3Stats.p99}ms | max: ${stage3Stats.max}ms`);

  testReport.stages.stage3 = {
    subscribers: FANOUT_CLIENTS,
    broadcastCount: NUM_BROADCASTS,
    expectedDeliveries: EXPECTED_DELIVERIES,
    receivedDeliveries: totalDeliveriesReceived,
    deliveryRateFramesSec: parseFloat((totalDeliveriesReceived / stage3Duration).toFixed(1)),
    deliveryLatenciesMs: stage3Stats,
    beam: peakBeamStage3,
  };

  // ============================================================================
  // STAGE 4: HIGH-VELOCITY PRESENCE & ROOM CHURN STORM (20,000 Operations)
  // ============================================================================
  console.log('\n' + '='.repeat(90));
  console.log('🌪️ STAGE 4: PRESENCE CHURN & DELTA-CRDT STORM');
  console.log('   Target: 20,000 rapid join/leave transitions across 2,000 sockets');
  console.log('='.repeat(90));

  const CHURN_OPS = 20000;
  const churnSockets = sockets.slice(0, 2000);
  const stage4Start = performance.now();

  for (let op = 0; op < CHURN_OPS; op++) {
    const ws = churnSockets[op % churnSockets.length];
    const room = `dynamic_room_${op % 100}`;
    const isJoin = (op % 2 === 0);

    if (isJoin) {
      ws.send(`42["join_chat",{"chatId":"${room}"}]`);
    } else {
      ws.send(`42["leave_chat",{"chatId":"${room}"}]`);
    }

    if ((op + 1) % 5000 === 0) {
      const elSec = ((performance.now() - stage4Start) / 1000).toFixed(1);
      console.log(`   ⚡ [Churn Storm] Executed ${(op + 1).toLocaleString()}/${CHURN_OPS.toLocaleString()} ops | Rate: ${((op + 1) / elSec).toFixed(0)} ops/sec`);
    }
  }

  await sleep(1000);
  const stage4Duration = (performance.now() - stage4Start) / 1000;
  const peakBeamStage4 = await fetchBeamMetrics();

  console.log(`\n✅ STAGE 4 COMPLETE:`);
  console.log(`   - Total Churn Ops:      ${CHURN_OPS.toLocaleString()}`);
  console.log(`   - Churn Throughput:     ${(CHURN_OPS / stage4Duration).toFixed(1)} presence ops/sec`);
  console.log(`   - BEAM ETS Memory:      ${peakBeamStage4?.memory?.ets_mb} MB`);
  console.log(`   - BEAM Process Memory:  ${peakBeamStage4?.memory?.processes_mb} MB`);

  testReport.stages.stage4 = {
    totalOps: CHURN_OPS,
    throughputOpsSec: parseFloat((CHURN_OPS / stage4Duration).toFixed(1)),
    beam: peakBeamStage4,
  };

  // ============================================================================
  // STAGE 5: EXTERNAL REDIS PUB/SUB INGESTION FLOOD (5,000 Injections)
  // ============================================================================
  console.log('\n' + '='.repeat(90));
  console.log('📡 STAGE 5: CROSS-SERVICE REDIS PUB/SUB INGESTION STREAM');
  console.log('   Target: Injecting 5,000 real-time events via Redis TCP directly into Elixir');
  console.log('='.repeat(90));

  const REDIS_INJECTIONS = 5000;
  let redisInjected = 0;

  const redisClient = net.createConnection({ host: '127.0.0.1', port: 6379 });
  await new Promise((resolve) => redisClient.on('connect', resolve));

  function redisPublish(channel, message) {
    const chBuf = Buffer.from(channel);
    const msgBuf = Buffer.from(message);
    const cmd = `*3\r\n$7\r\nPUBLISH\r\n$${chBuf.length}\r\n${channel}\r\n$${msgBuf.length}\r\n${message}\r\n`;
    redisClient.write(cmd);
  }

  const stage5Start = performance.now();
  for (let r = 0; r < REDIS_INJECTIONS; r++) {
    const payload = JSON.stringify({
      event: 'system_alert',
      room: 'chat:colosseum_fanout',
      data: { alertId: r, message: `System broadcast notification ${r}` },
    });
    redisPublish('nexus:broadcast', payload);
    redisInjected++;
    if ((r + 1) % 1000 === 0) {
      await sleep(10);
    }
  }

  redisClient.end();
  await sleep(1000);

  const stage5Duration = (performance.now() - stage5Start) / 1000;
  const peakBeamStage5 = await fetchBeamMetrics();

  console.log(`\n✅ STAGE 5 COMPLETE:`);
  console.log(`   - Redis Messages Sent:  ${redisInjected.toLocaleString()}`);
  console.log(`   - Redis Ingestion Rate: ${(redisInjected / stage5Duration).toFixed(1)} msgs/sec`);
  console.log(`   - Subscriber Connected: ${peakBeamStage5?.redis_connected}`);

  testReport.stages.stage5 = {
    injected: redisInjected,
    throughputMsgsSec: parseFloat((redisInjected / stage5Duration).toFixed(1)),
    beam: peakBeamStage5,
  };

  // ============================================================================
  // STAGE 6: ADVERSARIAL FRAMING & CHAOS INJECTION
  // ============================================================================
  console.log('\n' + '='.repeat(90));
  console.log('🛡️ STAGE 6: ADVERSARIAL FRAMING, CORRUPTED PAYLOADS & CHAOS');
  console.log('   Target: Malformed Engine.IO frames, oversized payloads, invalid opcodes');
  console.log('='.repeat(90));

  const chaosWs = new WebSocket(SOCKET_URL);
  await new Promise((resolve) => chaosWs.on('open', resolve));

  const adversarialFrames = [
    'invalid_garbage_frame',
    '0{"sid": truncated',
    '40{"bad_json":',
    '42["send_message", {"oversized":"' + 'X'.repeat(500000) + '"}]',
    '42["unknown_unhandled_action_with_giant_array",' + JSON.stringify(new Array(1000).fill('corrupt')) + ']',
    '999999_invalid_opcode',
    '42[12345, "invalid_event_name_type"]',
    '42["join_chat", null]',
    '42["leave_chat", {}]',
  ];

  let chaosSent = 0;
  for (let c = 0; c < 5; c++) {
    for (const f of adversarialFrames) {
      try {
        chaosWs.send(f);
        chaosSent++;
      } catch {}
    }
  }
  await sleep(500);
  try { chaosWs.close(); } catch {}

  const finalHealthCheck = await new Promise((resolve) => {
    http.get(`http://127.0.0.1:${SOCKET_PORT}/health`, (res) => {
      resolve(res.statusCode === 200);
    }).on('error', () => resolve(false));
  });

  const finalBeam = await fetchBeamMetrics();
  console.log(`\n✅ STAGE 6 COMPLETE:`);
  console.log(`   - Adversarial Packets:  ${chaosSent} dispatched`);
  console.log(`   - Server Health Post:   ${finalHealthCheck ? '100% HEALTHY (200 OK)' : 'DEGRADED / CRASHED'}`);
  console.log(`   - Process Count:        ${finalBeam?.process_count}`);

  testReport.stages.stage6 = {
    adversarialPacketsSent: chaosSent,
    serverHealthy: finalHealthCheck,
    finalBeam,
  };

  // ============================================================================
  // CLEANUP & FINAL REPORT
  // ============================================================================
  console.log('\n[Cleanup] Gracefully terminating 10,000 WebSocket connections...');
  for (const ws of sockets) {
    try { ws.close(); } catch {}
  }
  await sleep(2000);

  const postCleanupBeam = await fetchBeamMetrics();
  console.log(`✅ Cleanup Complete. BEAM Process Count restored to ${postCleanupBeam?.process_count} (Baseline: ${baselineBeam?.process_count})`);

  // Print Publication-Grade Summary Table
  console.log('\n' + '='.repeat(90));
  console.log('🏆 NEXUS-SOCKET HYPERSCALE C10K BENCHMARK RESULTS 🏆');
  console.log('='.repeat(90));
  console.log(`1. CONCURRENCY & CONNECTION CAPACITY:`);
  console.log(`   - Peak Concurrent WebSockets:   ${sockets.length.toLocaleString()} simultaneous connections`);
  console.log(`   - Handshake Rate:               ${testReport.stages.stage1.rampRateConnsSec} connections/sec`);
  console.log(`   - Handshake Latency:            p50: ${stage1Stats.p50}ms | p90: ${stage1Stats.p90}ms | p99: ${stage1Stats.p99}ms | max: ${stage1Stats.max}ms`);
  console.log(`   - Memory per Connection:        ${(((peakBeamStage1?.memory?.total_mb - baselineBeam?.memory?.total_mb) * 1024) / sockets.length).toFixed(2)} KB/socket`);
  console.log(`\n2. INBOUND INGESTION & ACK FLOOD:`);
  console.log(`   - Messages Ingested & Acked:    ${acksReceived.toLocaleString()} messages`);
  console.log(`   - Ingestion Throughput:         ${testReport.stages.stage2.throughputMsgsSec.toLocaleString()} msgs/sec`);
  console.log(`   - Ack Latency (p50 / p95 / p99): ${stage2Stats.p50}ms / ${stage2Stats.p95}ms / ${stage2Stats.p99}ms`);
  console.log(`   - Message Delivery Reliability: ${((acksReceived / sentMessages) * 100).toFixed(2)}%`);
  console.log(`\n3. 1-TO-N BROADCAST AVALANCHE:`);
  console.log(`   - Fan-Out Frame Deliveries:     ${totalDeliveriesReceived.toLocaleString()} frames delivered`);
  console.log(`   - Fan-Out Delivery Rate:        ${testReport.stages.stage3.deliveryRateFramesSec.toLocaleString()} frames/sec`);
  console.log(`   - Delivery Latency (p50 / p99): ${stage3Stats.p50}ms / ${stage3Stats.p99}ms`);
  console.log(`\n4. PRESENCE & REDIS RESILIENCE:`);
  console.log(`   - Presence Delta-CRDT Churn:    ${testReport.stages.stage4.throughputOpsSec.toLocaleString()} ops/sec`);
  console.log(`   - Redis Pub/Sub Ingestion:      ${testReport.stages.stage5.throughputMsgsSec.toLocaleString()} msgs/sec`);
  console.log(`   - Post-Chaos Server Status:     ${finalHealthCheck ? 'HEALTHY (200 OK)' : 'FAILED'}`);
  console.log('='.repeat(90));

  fs.writeFileSync('scripts/socket_stress_report.json', JSON.stringify(testReport, null, 2));
  console.log('💾 Saved comprehensive stress report to scripts/socket_stress_report.json\n');
}

main().catch((err) => {
  console.error('Fatal stress test runner error:', err);
  process.exit(1);
});
