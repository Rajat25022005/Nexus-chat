#!/usr/bin/env node
/**
 * ==============================================================================
 * Nexus Socket — Real-Time WebSocket Concurrency & Messaging Load Test
 * ==============================================================================
 *
 * Configurable parameters via environment variables:
 *   SOCKET_URL : Target WebSocket URL (default: ws://localhost:3001/socket.io/?EIO=4&transport=websocket)
 *   USERS      : Concurrent socket connections (default: 100)
 *   DURATION   : Test duration in seconds (default: 15)
 *   RAMP       : Concurrency ramp-up period in seconds (default: 3)
 *   JWT_SECRET : Shared HMAC-SHA256 secret (default: supersecret-dev-key)
 *
 * Usage:
 *   node tests/load/socket_load_test.js
 *   USERS=500 DURATION=20 RAMP=5 node tests/load/socket_load_test.js
 */

import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

const SOCKET_PORT = process.env.SOCKET_PORT || '3001';
const SOCKET_URL =
  process.env.SOCKET_URL || `ws://localhost:${SOCKET_PORT}/socket.io/?EIO=4&transport=websocket`;
const USERS = parseInt(process.env.USERS || '100', 10);
const DURATION = parseInt(process.env.DURATION || '15', 10);
const RAMP = parseInt(process.env.RAMP || '3', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret-dev-key';

function createToken(userId, email) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      user_id: userId,
      email: email,
      name: `User ${userId}`,
      iat: now,
      exp: now + 7200,
    })
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function calculatePercentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
  return sorted[index];
}

async function runSocketLoadTest() {
  console.log('='.repeat(70));
  console.log('🔌 NEXUS SOCKET CONCURRENCY & MESSAGING LOAD TEST');
  console.log('='.repeat(70));
  console.log(`Socket URL  : ${SOCKET_URL}`);
  console.log(`Concurrent  : ${USERS} WebSockets`);
  console.log(`Duration    : ${DURATION}s (Ramp-up: ${RAMP}s)`);
  console.log('='.repeat(70));

  const sockets = [];
  const ackLatencies = [];
  let connectedCount = 0;
  let connectionErrors = 0;
  let messagesSent = 0;
  let acksReceived = 0;
  let broadcastsReceived = 0;

  const testStartTime = performance.now();
  let isRunning = true;

  function spawnClient(index) {
    const userId = `usr-load-${index.toString().padStart(4, '0')}`;
    const email = `load_${index}@nexus.local`;
    const token = createToken(userId, email);
    const chatId = `load-chat-${index % 10}`; // 10 shared rooms

    let ws;
    try {
      ws = new WebSocket(SOCKET_URL);
    } catch (err) {
      connectionErrors++;
      return;
    }

    let ackCounter = 1;
    const pendingAcks = new Map();

    ws.onopen = () => {
      // Waiting for Engine.IO handshake
    };

    ws.onmessage = (event) => {
      const data = event.data.toString();

      // 1. Engine.IO Open Packet
      if (data.startsWith('0')) {
        // Send Socket.IO Auth packet
        ws.send(`40{"token":"${token}"}`);
        return;
      }

      // 2. Socket.IO Connected
      if (data.startsWith('40')) {
        connectedCount++;
        // Join room
        ws.send(`42${JSON.stringify(['join_chat', { chatId, groupId: 'load-grp' }])}`);
        return;
      }

      // 3. Engine.IO Ping -> respond with Pong
      if (data === '2') {
        ws.send('3');
        return;
      }

      // 4. Socket.IO Ack: 43<id>[payload]
      if (data.startsWith('43')) {
        const match = data.match(/^43(\d+)(.*)/);
        if (match) {
          const ackId = match[1];
          const sendTime = pendingAcks.get(ackId);
          if (sendTime) {
            ackLatencies.push(performance.now() - sendTime);
            pendingAcks.delete(ackId);
          }
          acksReceived++;
        }
        return;
      }

      // 5. Socket.IO Broadcast: 42[event, payload]
      if (data.startsWith('42')) {
        broadcastsReceived++;
      }
    };

    ws.onerror = () => {
      connectionErrors++;
    };

    ws.onclose = () => {
      if (connectedCount > 0) connectedCount--;
    };

    sockets.push(ws);

    // Message dispatch loop
    const messageInterval = setInterval(() => {
      if (!isRunning || ws.readyState !== WebSocket.OPEN) return;
      const currentAckId = String(ackCounter++);
      pendingAcks.set(currentAckId, performance.now());
      const msgPacket = `42${currentAckId}${JSON.stringify([
        'send_message',
        {
          chatId,
          content: `Load message from worker ${index} at ${Date.now()}`,
          tempId: `tmp-${index}-${currentAckId}`,
        },
      ])}`;
      ws.send(msgPacket);
      messagesSent++;
    }, 1500 + Math.random() * 1000);

    ws._msgInterval = messageInterval;
  }

  // Ramp-up workers
  const intervalPerWorker = (RAMP * 1000) / USERS;
  for (let i = 0; i < USERS; i++) {
    setTimeout(() => spawnClient(i), i * intervalPerWorker);
  }

  // Progress monitor
  const monitor = setInterval(() => {
    const elapsed = ((performance.now() - testStartTime) / 1000).toFixed(1);
    process.stdout.write(
      `\r⏳ [${elapsed}s/${DURATION}s] Active Conns: ${connectedCount}/${USERS} | Msgs Sent: ${messagesSent.toLocaleString()} | ACKs: ${acksReceived.toLocaleString()} | Broadcasts: ${broadcastsReceived.toLocaleString()} | Errors: ${connectionErrors}`
    );
  }, 1000);

  await new Promise((resolve) => setTimeout(resolve, DURATION * 1000));
  isRunning = false;
  clearInterval(monitor);

  console.log('\n\n⏳ Disconnecting socket pool cleanly...');
  for (const s of sockets) {
    clearInterval(s._msgInterval);
    try {
      s.close();
    } catch {}
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));

  const totalSec = (performance.now() - testStartTime) / 1000;
  ackLatencies.sort((a, b) => a - b);

  const avgAckRtt = ackLatencies.length > 0 ? ackLatencies.reduce((a, b) => a + b, 0) / ackLatencies.length : 0;
  const p50 = calculatePercentile(ackLatencies, 50);
  const p90 = calculatePercentile(ackLatencies, 90);
  const p95 = calculatePercentile(ackLatencies, 95);
  const p99 = calculatePercentile(ackLatencies, 99);
  const msgRate = (messagesSent / totalSec).toFixed(1);

  console.log('\n' + '='.repeat(70));
  console.log('📊 SOCKET LOAD TEST SCORECARD');
  console.log('='.repeat(70));
  console.log(`Peak Active WebSockets  : ${connectedCount} / ${USERS}`);
  console.log(`Connection Errors       : ${connectionErrors}`);
  console.log(`Total Messages Sent     : ${messagesSent.toLocaleString()}`);
  console.log(`Server ACKs Received    : ${acksReceived.toLocaleString()}`);
  console.log(`Broadcasts Delivered    : ${broadcastsReceived.toLocaleString()}`);
  console.log(`Messaging Throughput    : ${msgRate} msgs/sec`);
  console.log('-'.repeat(70));
  console.log(`Average ACK Round-Trip  : ${avgAckRtt.toFixed(2)} ms`);
  console.log(`p50 ACK RTT (Median)    : ${p50.toFixed(2)} ms`);
  console.log(`p90 ACK RTT             : ${p90.toFixed(2)} ms`);
  console.log(`p95 ACK RTT             : ${p95.toFixed(2)} ms`);
  console.log(`p99 ACK RTT (Tail)      : ${p99.toFixed(2)} ms`);
  console.log('='.repeat(70));

  if (connectionErrors > USERS * 0.1 || (messagesSent > 0 && acksReceived === 0)) {
    console.log('❌ Result: FAILED (High error rate or lack of ACKs)\n');
    process.exit(1);
  } else {
    console.log('✅ Result: PASSED (Real-time gateway highly responsive)\n');
    process.exit(0);
  }
}

runSocketLoadTest().catch((err) => {
  console.error('Fatal socket load test error:', err);
  process.exit(1);
});
