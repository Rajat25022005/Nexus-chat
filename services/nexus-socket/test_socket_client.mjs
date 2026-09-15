/**
 * nexus-socket — Zero-Dependency End-to-End WebSocket Test Client
 *
 * Uses Node.js 20+ native WebSocket API (no npm install required).
 * Verifies:
 * 1. Engine.IO v4 handshake (open packet `0`)
 * 2. Socket.IO v4 authentication (`40{"token":"..."}`)
 * 3. Topic joining (`join_chat`)
 * 4. Message dispatch (`send_message`) with ACK callback
 * 5. Incoming broadcast reception (`new_message`)
 * 6. Real-time Redis AI token streaming reception (`ai_stream_chunk`)
 * 7. Engine.IO heartbeat ping/pong (`2` / `3`)
 *
 * Usage:
 *   node test_socket_client.mjs [PORT] [CHAT_ID]
 * Example:
 *   node test_socket_client.mjs 3001 my-test-chat
 */

const port = process.argv[2] || 3001;
const chatId = process.argv[3] || 'demo-room-42';
const socketUrl = `ws://localhost:${port}/socket.io/?EIO=4&transport=websocket`;

// Generate a valid HS256 JWT matching the dev secret "supersecret-dev-key"
function createDevJwt(payload) {
  const crypto = require('crypto');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', 'supersecret-dev-key')
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

const now = Math.floor(Date.now() / 1000);
const testToken = createDevJwt({
  user_id: 'usr-tester-001',
  email: 'tester@nexus.local',
  name: 'Test Engineer',
  exp: now + 3600
});

console.log('='.repeat(60));
console.log(`🚀 Connecting to Nexus Socket at ${socketUrl}...`);
console.log(`👤 Authenticating as: usr-tester-001 (tester@nexus.local)`);
console.log(`💬 Target Chat Room: ${chatId}`);
console.log('='.repeat(60));

const ws = new WebSocket(socketUrl);

ws.on('open', () => {
  console.log('🔌 TCP WebSocket connected. Awaiting Engine.IO handshake...');
});

ws.on('message', (data) => {
  const text = data.toString();

  // 1. Engine.IO Open Packet: 0{...}
  if (text.startsWith('0')) {
    const handshake = JSON.parse(text.slice(1));
    console.log('✅ [1/5] Engine.IO Handshake OK!');
    console.log(`      Session ID: ${handshake.sid}, Ping Interval: ${handshake.pingInterval}ms`);

    // Send Socket.IO Connect packet with auth token
    const connectPacket = `40{"token":"${testToken}"}`;
    console.log('🔑 [2/5] Sending Socket.IO Auth Connect Packet...');
    ws.send(connectPacket);
    return;
  }

  // 2. Socket.IO Connect Ack: 40{...}
  if (text.startsWith('40')) {
    console.log('✅ [2/5] Socket.IO Connected & Authenticated!');
    
    // Join chat room
    console.log(`🚪 [3/5] Joining room chat:${chatId}...`);
    const joinPacket = `42${JSON.stringify(['join_chat', { chatId, groupId: 'grp-test' }])}`;
    ws.send(joinPacket);

    // Send a message with Ack ID '1'
    setTimeout(() => {
      console.log('✉️  [4/5] Sending chat message with Ack ID 1...');
      const msgPacket = `421${JSON.stringify([
        'send_message',
        {
          chatId,
          content: 'Hello Nexus! Verifying Elixir socket service.',
          tempId: 'temp-123'
        }
      ])}`;
      ws.send(msgPacket);
    }, 200);
    return;
  }

  // 3. Socket.IO Ack Response: 431[...]
  if (text.startsWith('431')) {
    const ackPayload = JSON.parse(text.slice(3));
    console.log('✅ [4/5] Received Server ACK for Message!');
    console.log(`      Message ID assigned by server: ${ackPayload[0]?.messageId}`);
    return;
  }

  // 4. Socket.IO Events: 42[...]
  if (text.startsWith('42')) {
    const [event, payload] = JSON.parse(text.slice(2));

    if (event === 'new_message') {
      console.log(`📩 Broadcast received: [${payload.userName}]: "${payload.content}" (ID: ${payload.id})`);
      console.log('='.repeat(60));
      console.log('🎉 REAL-TIME CHAT & MESSAGING VERIFIED SUCCESSFULLY!');
      console.log('='.repeat(60));
      console.log(`💡 To test Redis AI streaming now, run this in another terminal:`);
      console.log(`   redis-cli PUBLISH "room:${chatId}:ai_stream" '{"delta":"Streaming from Redis!","is_final":true,"message_id":"ai_1"}'`);
      console.log(`\n(Press Ctrl+C to exit)`);
    } else if (event === 'ai_stream_chunk') {
      console.log(`🤖 AI STREAM CHUNK RECEIVED: delta="${payload.delta}", isFinal=${payload.isFinal}`);
    } else {
      console.log(`🔔 Event received: ${event}`, payload);
    }
    return;
  }

  // 5. Engine.IO Ping: 2 -> Reply Pong: 3
  if (text === '2') {
    ws.send('3');
    // console.log('💓 Heartbeat Ping/Pong');
    return;
  }

  console.log('ℹ️  Raw packet:', text);
});

ws.on('error', (err) => {
  console.error('❌ WebSocket Error:', err.message);
});

ws.on('close', (code, reason) => {
  console.log(`🔌 Connection closed (code: ${code}, reason: ${reason || 'none'})`);
});
