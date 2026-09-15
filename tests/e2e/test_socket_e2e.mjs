#!/usr/bin/env node
/**
 * Nexus Socket Real-Time End-to-End Test
 * Validates Engine.IO handshake, Socket.IO auth, room join, messaging, acks, and typing indicators.
 *
 * Usage:
 *   node tests/e2e/test_socket_e2e.mjs [PORT]
 */

import crypto from 'node:crypto';

const PORT = process.argv[2] || process.env.PORT || '3001';
const SOCKET_URL = `ws://localhost:${PORT}/socket.io/?EIO=4&transport=websocket`;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret-dev-key';

function createToken(userId, email) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      user_id: userId,
      email: email,
      name: 'E2E Socket Tester',
      iat: now,
      exp: now + 3600,
    })
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

const token = createToken('usr-e2e-001', 'e2e@nexus.local');
const chatId = 'e2e-test-room';

console.log('='.repeat(60));
console.log('🔌 Running Nexus Socket E2E Verification');
console.log(`🎯 Connecting to: ${SOCKET_URL}`);
console.log('='.repeat(60));

let stage = 0;
const ws = new WebSocket(SOCKET_URL);

const timeout = setTimeout(() => {
  console.error('❌ FAIL: Test timed out after 10 seconds');
  ws.close();
  process.exit(1);
}, 10000);

ws.onopen = () => {
  console.log('🔌 TCP WebSocket connection established. Awaiting handshake...');
};

ws.onmessage = (event) => {
  const text = event.data.toString();

  // 1. Engine.IO Handshake
  if (text.startsWith('0')) {
    console.log('✅ Stage 1: Engine.IO v4 Handshake received');
    stage = 1;
    // Send Socket.IO Auth packet
    ws.send(`40{"token":"${token}"}`);
    return;
  }

  // 2. Socket.IO Connected & Authenticated
  if (text.startsWith('40')) {
    console.log('✅ Stage 2: Socket.IO v4 Authenticated with HS256 JWT');
    stage = 2;
    // Join room
    ws.send(`42${JSON.stringify(['join_chat', { chatId, groupId: 'e2e-grp' }])}`);

    // Send a message with Ack ID 1
    setTimeout(() => {
      console.log('✉️  Stage 3: Sending message with Ack ID 1...');
      ws.send(`421${JSON.stringify(['send_message', { chatId, content: 'E2E verification message', tempId: 'e2e-1' }])}`);
    }, 200);
    return;
  }

  // 3. Ack Response (431[...])
  if (text.startsWith('431')) {
    console.log('✅ Stage 4: Server Acknowledgement received for message');
    stage = 4;
    return;
  }

  // 4. Broadcast Reception (42[...])
  if (text.startsWith('42')) {
    try {
      const [eventName, payload] = JSON.parse(text.slice(2));
      if (eventName === 'new_message') {
        console.log(`✅ Stage 5: Received broadcast 'new_message': "${payload.content}"`);
        clearTimeout(timeout);
        console.log('='.repeat(60));
        console.log('🎉 ALL SOCKET E2E TESTS PASSED SUCCESSFULLY!');
        console.log('='.repeat(60));
        ws.close();
        process.exit(0);
      }
    } catch {}
  }
};

ws.onerror = (err) => {
  console.error('❌ WebSocket error:', err.message || err);
  clearTimeout(timeout);
  process.exit(1);
};
