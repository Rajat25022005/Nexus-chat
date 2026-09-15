# Nexus Socket Service (Elixir / Phoenix OTP)

A production-grade, highly concurrent, fault-tolerant real-time socket microservice for Nexus Chat. Built in Elixir / OTP with Bandit, Phoenix Channels, and Phoenix.Tracker Delta-CRDTs, providing full Engine.IO v4 and Socket.IO v4 protocol fidelity for React 19 clients (`socket.io-client@^4.8.3`).

---

## 1. Architecture Overview

- **Web & Transport Gateway**: Native HTTP/1.1, HTTP/2, and WebSocket engine powered by **Bandit 1.12+** on top of `thousand_island` and `WebSock`. Delivers ~2.6 KB memory per connection with ultra-low latency.
- **Protocol Translation Layer**:
  - `NexusSocket.Protocol.EngineIO`: Pure functional decoder/encoder for Engine.IO v4 framing (handshake open `0`, server-initiated ping `2`, client pong `3`, probes `2probe`/`3probe`, upgrades `5`, message framing `4`).
  - `NexusSocket.Protocol.SocketIO`: Pure functional decoder/encoder for Socket.IO v4 (Revision 5) wire packets (connect `40`, disconnect `41`, event `42`, ack `43`, error `44`). Supports default namespace (`/`) and custom namespaces (`/namespace,`), along with numeric acknowledgment routing.
- **Authentication & In-Memory ETS Cache**:
  - `NexusSocket.Auth.Jwt`: HS256 JWT signature verification using Erlang `:crypto` with claim validation (`user_id`, `email`, `exp`). Secret configurable via `JWT_SECRET` (fallback: `"supersecret-dev-key"`).
  - `NexusSocket.Auth.Cache`: Named ETS table (`:nexus_jwt_cache`) with `:read_concurrency` and `:write_concurrency`. Caches verified user claims to prevent database/crypto bottlenecks. Managed by a GenServer table owner with periodic atomic TTL eviction (`:ets.select_delete/2`).
- **Distributed Presence (Delta-CRDTs)**:
  - `NexusSocket.Presence.Tracker`: Cluster-wide online user tracking across `chat:<chat_id>` and `workspace:<id>` using `Phoenix.Tracker` backed by Erlang process groups (`:pg`). Reconciles concurrent joins and leaves without Redis or database polling.
- **Real-Time Chat & Multiplexing**:
  - `NexusSocket.Channels.ChannelHandler`: Handles client events (`join_chat`, `leave_chat`, `send_message`, `edit_message`, `delete_message`, `react_message`, `send_thread_reply`, `typing_start`, `typing_stop`, `get_online_users`).
  - Room broadcasting over `Phoenix.PubSub`: Emits `new_message`, `message_updated`, `message_edited`, `message_deleted`, `message_reacted`, `thread_reply`, `typing_indicator`, `user_joined`, and `user_left`.
- **Soft Real-Time AI Token Streaming**:
  - `NexusSocket.AiStreamBuffer`: Adaptive micro-batching GenServer (25ms window / 48-char buffer threshold) with backpressure support, coalescing LLM inference tokens into smooth `ai_stream_chunk` payloads without React UI thrashing.

---

## 2. OTP Supervision Tree

The application enforces a strict `:rest_for_one` supervision hierarchy to guarantee failure domain isolation:

```text
                                [NexusSocket.Supervisor]
                                           │ (:rest_for_one)
   ┌───────────────────┬───────────────────┼───────────────────┬───────────────────┬───────────────────┐
   ▼                   ▼                   ▼                   ▼                   ▼                   ▼
Telemetry         Auth.Cache         Phoenix.PubSub    Presence.Tracker     AiStreamBuffer   PartitionSupervisor   Bandit
(:one_for_one)  (ETS Owner/Sweeper)    (Erlang :pg)      (Delta-CRDT)       (Micro-Batching) (Dynamic Supervisors) (Port 3001)
```

1. **`NexusSocket.Telemetry`**: VM metric instrumentation and process memory poller.
2. **`NexusSocket.Auth.Cache`**: Named ETS table owner and periodic atomic TTL sweeper.
3. **`Phoenix.PubSub`**: High-speed distributed messaging backbone.
4. **`NexusSocket.Presence.Tracker`**: Distributed Delta-CRDT presence engine.
5. **`NexusSocket.AiStreamBuffer`**: Micro-batching GenServer for AI inference streaming.
6. **`PartitionSupervisor` (`NexusSocket.ConnectionSupervisor`)**: Dynamically partitions connection child processes across online CPU cores for lock-free horizontal concurrency.
7. **`Bandit`**: HTTP and WebSocket server handling `/socket.io/*` routes and health checks.

---

## 3. Configuration & Environment Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | Integer | `3001` | TCP port for Bandit HTTP and WebSocket server |
| `JWT_SECRET` | String | `supersecret-dev-key` | Shared HMAC-SHA256 secret for JWT verification |
| `MIX_ENV` | String | `dev` | Environment mode (`dev`, `test`, `prod`) |
| `DATABASE_URL` | String | Optional | PostgreSQL connection string |
| `REDIS_URL` | String | Optional | Redis connection string for external bridges |

---

## 4. Getting Started & Local Execution

### Prerequisites
- Elixir 1.14+ (tested on Elixir 1.20.4)
- Erlang/OTP 25+ (tested on Erlang/OTP 29.0.6)

### Fetch Dependencies & Compile
```bash
mix deps.get
mix compile --warnings-as-errors
```

### Run Test Suite
```bash
mix test
```

### Start the Service
```bash
mix run --no-halt
```
The service will start listening on `http://0.0.0.0:3001`.

---

## 5. Endpoints & Protocol Reference

### HTTP Endpoints
- `GET /health`: Liveness probe. Returns HTTP 200 `{"status":"healthy","service":"nexus-socket"}`.
- `GET /ready`: Readiness probe. Returns HTTP 200 `{"status":"ready","service":"nexus-socket"}`.
- `GET /socket.io/?EIO=4&transport=polling`: HTTP long-polling handshake fallback.
- `POST /socket.io/?EIO=4&transport=polling`: Polling packet delivery.

### WebSocket Connection
- **URL**: `ws://localhost:3001/socket.io/?EIO=4&transport=websocket`
- **Handshake Open**: `0{"sid":"...","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}`
- **Connect Packet**: `40{"token":"<jwt_token>"}`
  - Success: `40{"sid":"..."}`
  - Failure: `44{"message":"Invalid authentication token"}`
- **Heartbeat**: Server sends `2` every 25s; Client responds `3`.

### Client Events Handled
- `join_chat`: `%{ "chatId": string, "groupId": string }`
- `leave_chat`: `%{ "chatId": string }`
- `send_message`: `%{ "chatId": string, "content": string, "tempId": string, ... }` (with ACK callback)
- `edit_message`: `%{ "messageId": string, "content": string, "chatId": string }`
- `delete_message`: `%{ "messageId": string, "chatId": string, "deleteType": "everyone"|"me" }`
- `react_message`: `%{ "messageId": string, "emoji": string, "chatId": string }` (with ACK callback)
- `send_thread_reply`: `%{ "parentMessageId": string, "content": string, "chatId": string }` (with ACK callback)
- `typing_start` / `typing_stop`: `%{ "chatId": string }`
- `get_online_users`: (with ACK callback returning online member list)

---

## 6. Docker Containerization

### Build Production Release Image
```bash
docker build -t nexus-socket:latest .
```

### Run Container
```bash
docker run -d \
  -p 3000:3001 \
  -e PORT=3001 \
  -e JWT_SECRET="your-production-secret" \
  --name nexus-socket \
  nexus-socket:latest
```
The multi-stage build uses `mix release` and `debian:bookworm-slim` to create a lightweight (<110MB) release running under an unprivileged user (`nexus`, UID 10001) with active health checks.

---

## 7. Redis Pub/Sub Integration (Multi-Service & Local Testing)

`nexus-socket` includes a zero-dependency, OTP-supervised Redis Pub/Sub subsystem (`NexusSocket.Redis.Subscriber` and `NexusSocket.Redis.Publisher`) that bridges external services with connected WebSocket clients:

```text
┌─────────────────────────┐          Redis Pub/Sub          ┌─────────────────────────┐
│     nexus-ai-worker     │ ── PUBLISH room:*:ai_stream ──> │      nexus-socket       │ ── WSS ai_stream_chunk ──> React 19 Client
└─────────────────────────┘                                 │  (Elixir/Bandit Node)   │
┌─────────────────────────┐                                 │                         │
│  nexus-api / External   │ ── PUBLISH nexus:broadcast ───> │  NexusSocket.Redis      │ ── WSS room events ──────> React 19 Client
└─────────────────────────┘                                 │  Subscriber & Publisher │
┌─────────────────────────┐                                 │                         │
│ Analytics / Audit Logs  │ <── SUBSCRIBE nexus:events ──── │  (Auto-reconnecting)    │ <── WSS new_message ────── React 19 Client
└─────────────────────────┘                                 └─────────────────────────┘
```

### Channel Routing Contracts

1. **AI Token Ingestion (`room:*:ai_stream`)**:
   - `nexus-ai-worker` publishes JSON inference chunks:
     ```json
     {"delta": "Hello world", "is_final": false, "message_id": "msg_001"}
     ```
   - `nexus-socket` pattern-subscribes (`PSUBSCRIBE room:*:ai_stream`), passes tokens to `NexusSocket.AiStreamBuffer` for adaptive micro-batching (25ms window / 48-char buffer), and broadcasts `ai_stream_chunk` frames to `chat:<chat_id>` subscribers.

2. **Cross-Service Broadcasting (`nexus:broadcast`)**:
   - Any external service can broadcast events to any room topic by publishing:
     ```json
     {
       "topic": "chat:c_123",
       "event": "system_announcement",
       "payload": {"title": "Maintenance", "body": "Server reboot in 5m"}
     }
     ```

3. **Event Egress (`nexus:events`)**:
   - User messages (`new_message`, `message_edited`, etc.) are automatically mirrored to Redis channel `nexus:events`, allowing external workers or analytics loggers to consume real-time chat activity.

### Testing Locally with `redis-cli` on your PC

1. **Start Redis**:
   ```bash
   redis-server
   # Or using Docker:
   docker run -p 6379:6379 redis:7-alpine
   ```

2. **Start the Socket Service**:
   ```bash
   cd nexus-socket
   export REDIS_URL="redis://localhost:6379"
   mix run --no-halt
   ```

3. **Simulate AI Token Streaming from `redis-cli`**:
   In another terminal, publish tokens to a test chat room (e.g. `chat_42`):
   ```bash
   # Stream token 1:
   redis-cli PUBLISH "room:chat_42:ai_stream" '{"delta":"Nexus AI is generating... ","is_final":false,"message_id":"m1"}'

   # Stream token 2 (final):
   redis-cli PUBLISH "room:chat_42:ai_stream" '{"delta":"Response complete!","is_final":true,"message_id":"m1"}'
   ```
   Connected clients in room `chat:chat_42` will receive `ai_stream_chunk` in real time with zero packet loss.

4. **Monitor Outbound Events**:
   ```bash
   redis-cli SUBSCRIBE "nexus:events"
   ```
   When a user sends a chat message via WebSocket, the event payload is streamed into `nexus:events`.

