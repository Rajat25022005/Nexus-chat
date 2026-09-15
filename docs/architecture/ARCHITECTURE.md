# Nexus Workplace AI — Production Architecture (Final)

> **Scope**: Complete architectural blueprint for transforming Nexus from a monolithic Python/FastAPI application into a **multi-tenant SaaS** platform built on **Golang + Node.js + C++ microservices**, **Google Cloud Platform**, and a **multi-model AI gateway**.

---

## Table of Contents

1. [Current Architecture Audit](#1-current-architecture-audit)
2. [Target Production Architecture](#2-target-production-architecture)
3. [Microservices Breakdown](#3-microservices-breakdown)
4. [Repository Structure & gRPC Proto](#4-repository-structure--grpc-proto)
27. [C++ Integration Plan — nexus-compute](#27-c-integration-plan--nexus-compute)
5. [Multi-Tenant SaaS Data Model](#5-multi-tenant-saas-data-model)
6. [Real-Time Messaging Flow](#6-real-time-messaging-flow)
7. [AI Streaming Response Architecture](#7-ai-streaming-response-architecture)
28. [Redis Streams — Message Queue Architecture](#28-redis-streams--message-queue-architecture)
8. [Authentication — Firebase](#8-authentication--firebase)
9. [AI Gateway — Multi-Model Routing](#9-ai-gateway--multi-model-routing)
10. [RAG Pipeline — Dedicated Retrieval Service](#10-rag-pipeline--dedicated-retrieval-service)
11. [Caching Strategy — Upstash Redis](#11-caching-strategy--upstash-redis)
12. [Database Layer — Cloud SQL (PostgreSQL)](#12-database-layer--cloud-sql-postgresql)
13. [Vector Search — Qdrant Cloud](#13-vector-search--qdrant-cloud)
14. [File Storage — Google Cloud Storage](#14-file-storage--google-cloud-storage)
15. [Async Job Processing — Redis Streams](#15-async-job-processing--redis-streams)
16. [API Gateway & Rate Limiting](#16-api-gateway--rate-limiting)
17. [Security, GDPR & Compliance](#17-security-gdpr--compliance)
18. [Backup & Disaster Recovery](#18-backup--disaster-recovery)
19. [Observability — GCP Operations Suite](#19-observability--gcp-operations-suite)
20. [CI/CD Pipeline](#20-cicd-pipeline)
21. [Local Development Environment](#21-local-development-environment)
22. [Deployment Topology](#22-deployment-topology)
23. [Environment Variables & Secrets](#23-environment-variables--secrets)
24. [Cost Estimation](#24-cost-estimation)
25. [Data Migration Runbook](#25-data-migration-runbook)
26. [Implementation Roadmap](#26-implementation-roadmap)

---

## 1. Current Architecture Audit

### What Exists Today

```mermaid
graph TB
    subgraph Client["Browser / Mobile"]
        FE["React 19 + Vite\nSocket.IO Client"]
    end

    subgraph Backend["Single Process — Cloud Run"]
        FE -->|HTTPS REST| FA["FastAPI"]
        FE -->|WSS| SIO["Socket.IO (in-process)"]
        FA --> SIO
    end

    subgraph Data["Data Layer"]
        FA --> MDB["MongoDB Atlas\n(messages + users + groups + vectors)"]
        SIO --> MDB
        FA -->|Embedding| ST["SentenceTransformers\n(loaded in-process)"]
        FA -->|Generation| GEM["Google Gemini API"]
    end

    subgraph Files["File Storage"]
        FA --> FS["Local Filesystem\n/app/static/avatars ❌"]
    end

    style FS fill:#ff6b6b,color:#fff
    style ST fill:#ffa94d,color:#fff
```

### Critical Production Gaps

| Area | Current State | Risk | Resolution |
|---|---|---|---|
| **Backend** | Python/FastAPI monolith | Can't scale individual concerns | Split into Go + Node.js + Python microservices |
| **Socket.IO adapter** | In-memory | Sessions lost on restart; no horizontal scaling | Upstash Redis adapter |
| **Message queue** | Direct synchronous calls | AI blocks the socket event loop | Redis Streams (Upstash Redis) |
| **File storage** | Local filesystem | Files wiped on container restart | Google Cloud Storage |
| **Embedding model** | SentenceTransformers in-process | ~400 MB RAM per pod; cold start > 30s | BGE-M3 in dedicated `nexus-rag` service |
| **AI provider** | Hardcoded Gemini only | Single point of failure; no cost control | Multi-model AI Gateway |
| **Vector search** | MongoDB `$vectorSearch` | Atlas-only vendor lock; no hybrid search | Qdrant Cloud |
| **Authentication** | Custom JWT in localStorage | XSS vulnerable; OTP maintenance burden | Firebase Authentication |
| **Rate limiting** | In-memory dict | Reset on restart; not shared | Upstash Redis sliding window |
| **Observability** | `print()` / basic `logger` | Zero visibility in production | GCP Cloud Logging/Monitoring/Trace |
| **Security** | No WAF, no secret manager | Exposed to DDoS, secrets in .env | Cloud Armor + Secret Manager |
| **Multi-tenancy** | None | Can't support organizations/teams | `tenant_id` + `workspace_id` everywhere |

---

## 2. Target Production Architecture

```mermaid
graph TB
    subgraph Edge["Edge / Ingress"]
        ARMOR["Cloud Armor\n(WAF · DDoS · Bot Protection)"]
        GLB["Global Load Balancer\n(TLS Termination)"]
    end

    subgraph Auth["Identity"]
        FBA["Firebase Authentication\n(Google · GitHub · Email)"]
    end

    subgraph Services["Microservices — GKE Autopilot"]
        direction TB
        API["nexus-api (Go)\n(REST · CRUD)"]
        SIO["nexus-socket (Node.js)\n(Socket.IO · Real-Time)"]
        RAG["nexus-rag (Python)\n(BGE-M3 · Reranker · Qdrant)"]
        AIGW["nexus-ai-gateway (Go)\n(Model Router · Fallback · Cost)"]
        WRK["nexus-ai-worker (Go)\n(Redis Streams Consumer)"]
        BILL["nexus-billing (Go)\n(Usage · Invoices · Quotas)"]
        COMP["nexus-compute (C++)\n(Memory Mgmt · Zero-Copy · Indexes)"]
    end

    subgraph Messaging["Upstash Redis — Streams"]
        PUB["Streams:\n• stream:ai.inference\n• stream:embed.messages\n• stream:notifications\n• stream:webhooks"]
    end

    subgraph Cache["Upstash Redis — Cache"]
        MEM["• Socket.IO Adapter\n• Rate Limiting\n• Session Cache\n• AI Response Cache\n• Message Page Cache\n• Presence / Typing"]
    end

    subgraph Storage["Data & Storage Tier"]
        PDB["Cloud SQL (PostgreSQL 16)\n(Primary + Read Replica)"]
        QDR["Qdrant Cloud\n(Vector Search)"]
        GCS["Google Cloud Storage\n(Avatars · Documents · Exports)"]
        BQ["BigQuery\n(Analytics · Audit Stream)"]
    end

    subgraph Observe["GCP Operations Suite"]
        LOG["Cloud Logging"]
        MON["Cloud Monitoring"]
        TRC["Cloud Trace"]
        ERR["Cloud Error Reporting"]
    end

    Client["Web / Mobile"] -->|Auth| FBA
    Client --> ARMOR
    ARMOR --> GLB
    GLB --> API & SIO

    API & SIO --> MEM
    API & SIO --> PDB
    API & SIO --> PUB

    PUB --> WRK
    WRK --> RAG
    WRK --> COMP
    RAG --> QDR
    RAG --> AIGW

    AIGW -->|Route| LLMs["Gemini · Claude · GPT · DeepSeek · Gemma"]

    API --> GCS
    PDB -.->|LISTEN/NOTIFY + CDC| BQ

    API & SIO & WRK & RAG & AIGW & BILL & COMP --> LOG & MON & TRC & ERR
```

### Technology Stack Summary

| Layer | Technology | Purpose |
|---|---|---|
| **Language** | Go 1.22+ / Node.js 22 / Python 3.12 / C++20 | Go for API/Gateway/Worker/Billing; Node.js for Socket; Python for RAG; C++ for Memory-Intensive Compute |
| **Frontend** | React 19 + Vite | Client SPA |
| **Auth** | Firebase Authentication | Google, GitHub, Email/Password |
| **REST API** | Gin / Echo (Go) | HTTP routing in `nexus-api` |
| **WebSocket** | Socket.IO (Node.js) + `@socket.io/redis-adapter` | Battle-tested real-time in `nexus-socket` |
| **Message Queue** | Upstash Redis Streams | Async AI inference, notifications, embedding jobs |
| **Cache** | Upstash Redis | Sessions, rate limiting, Socket.IO adapter, pub/sub |
| **Database** | Cloud SQL (PostgreSQL 16) | Multi-tenant persistent data, RLS, ACID billing |
| **Vector DB** | Qdrant Cloud | Semantic search with hybrid retrieval |
| **Object Storage** | Google Cloud Storage (GCS) | Avatars, documents, attachments |
| **Analytics** | BigQuery | Audit logs, usage analytics, billing |
| **CDN** | Cloud CDN | Static assets + GCS file delivery |
| **WAF** | Cloud Armor | DDoS, bot protection, IP filtering |
| **Secrets** | Secret Manager | All sensitive credentials |
| **Monitoring** | Cloud Monitoring | Metrics dashboards, alerting |
| **Logging** | Cloud Logging | Structured JSON logs |
| **Tracing** | Cloud Trace | Distributed request tracing |
| **Errors** | Cloud Error Reporting | Panic/crash grouping & alerts |
| **Billing** | `nexus-billing` (Go) | Token metering, invoice generation, quota enforcement |
| **High-Perf Compute** | `nexus-compute` (C++) | Custom allocators, mmap I/O, zero-copy buffers, in-memory indexes |
| **Container Orchestration** | GKE Autopilot | Fully managed nodes, auto-scaling, per-pod billing |
| **CI/CD** | GitHub Actions + Cloud Build | Lint → Test → Build → Deploy |

---

## 3. Microservices Breakdown

The monolithic FastAPI backend is decomposed into **seven** focused microservices across **four languages**, each chosen for its strongest use case:
- **Go** (4 services): API, AI Gateway, AI Worker, Billing — for high concurrency, minimal memory (~10 MB), sub-second cold starts.
- **Node.js** (1 service): Socket — because the official Socket.IO library is battle-tested, feature-complete, and has native Redis adapter support. Go Socket.IO libraries (`googollee/go-socket.io`) are poorly maintained and lack features like auto-reconnection, binary payloads, and namespaces.
- **Python** (1 service): RAG — because BGE-M3, BGE-Reranker, and HuggingFace/PyTorch run natively in Python.
- **C++** (1 service): Compute — for workloads requiring extensive memory management: custom allocators, memory-mapped I/O, zero-copy buffers, and large in-memory data structures where Go/Python GC pauses are unacceptable.

```mermaid
graph LR
    subgraph GoServices["Go Microservices"]
        API["nexus-api\n━━━━━━━━━━━━━\n• Users CRUD\n• Workspace/Group/Chat CRUD\n• File upload (signed URLs)\n• RBAC enforcement"]
        
        AIGW["nexus-ai-gateway\n━━━━━━━━━━━━━\n• Model routing\n• Fallback chains\n• Cost tracking\n• Rate control\n• Response caching"]
        
        WRK["nexus-ai-worker\n━━━━━━━━━━━━━\n• Redis Streams consumer\n• Orchestrates RAG + LLM\n• Writes AI responses\n• Triggers embedding\n• Dead-letter handling"]
        
        BILL["nexus-billing\n━━━━━━━━━━━━━\n• Token usage tracking\n• Storage metering\n• API call counting\n• Invoice generation\n• Quota enforcement"]
    end

    subgraph NodeService["Node.js Microservice"]
        SIO["nexus-socket\n━━━━━━━━━━━━━\n• Socket.IO server\n• Room management\n• Presence & typing\n• AI stream relay\n• Redis adapter sync"]
    end

    subgraph PythonService["Python Microservice"]
        RAG["nexus-rag\n━━━━━━━━━━━━━\n• BGE-M3 embeddings\n• Qdrant retrieval\n• BGE-Reranker scoring\n• Prompt construction\n• Context window mgmt"]
    end

    subgraph CppService["C++ Microservice"]
        COMP["nexus-compute\n━━━━━━━━━━━━━\n• Arena allocators\n• Memory-mapped file I/O\n• Zero-copy buffers\n• In-memory indexes\n• Binary payload processing"]
    end
```

### Service Language Matrix

| Service | Language | Rationale |
|---|---|---|
| `nexus-api` | **Go** | High-throughput REST, minimal memory |
| `nexus-socket` | **Node.js** | Official Socket.IO library; native `@socket.io/redis-adapter`; auto-reconnect, rooms, namespaces |
| `nexus-ai-gateway` | **Go** | Fast HTTP proxy, circuit breakers |
| `nexus-ai-worker` | **Go** | Concurrent Redis Streams consumer |
| `nexus-billing` | **Go** | High-frequency metering writes |
| `nexus-rag` | **Python** | Native BGE-M3 / BGE-Reranker / PyTorch / HuggingFace |
| `nexus-compute` | **C++** | Custom allocators, zero-copy buffers, mmap I/O, lock-free data structures; no GC pauses |

### Service Communication Matrix

| From → To | Protocol | Purpose |
|---|---|---|
| `nexus-api` → `nexus-socket` | Redis PubSub | Push events to connected clients |
| `nexus-socket` → Redis Streams | Redis protocol (XADD) | Enqueue AI inference jobs |
| Redis Streams → `nexus-ai-worker` | Redis protocol (XREADGROUP) | Deliver AI tasks to workers |
| `nexus-ai-worker` → `nexus-rag` | gRPC (internal) | Request context retrieval |
| `nexus-ai-worker` → `nexus-compute` | gRPC (internal) | Offload memory-intensive processing |
| `nexus-rag` → Qdrant Cloud | gRPC / HTTP | Vector similarity search |
| `nexus-ai-worker` → `nexus-ai-gateway` | gRPC (internal) | Request LLM completion |
| `nexus-ai-gateway` → LLM providers | HTTPS | Gemini, Claude, GPT, DeepSeek, Gemma |
| `nexus-ai-gateway` → `nexus-billing` | gRPC (internal) | Report token usage per request |
| `nexus-api` → `nexus-billing` | gRPC (internal) | Check tenant quota before operations |
| `nexus-api` → `nexus-compute` | gRPC (internal) | File processing, thumbnail generation |
| `nexus-billing` → BigQuery | Streaming insert | Usage analytics & invoice data |
| `nexus-ai-worker` → Redis PubSub | Redis protocol | Broadcast AI reply to room |
| All services → Upstash Redis | Redis protocol | Caching, rate limiting, sessions, streams |
| All services → Cloud SQL | PostgreSQL wire protocol | Persistent data reads/writes, RLS enforced |

### Service Resource Budgets (GKE Autopilot)

> **Note**: GKE Autopilot automatically provisions node resources based on pod requests. You only define pod-level resource specs — no node pools to manage.

| Service | Language | CPU Request | CPU Limit | Memory Request | Memory Limit | Replicas (HPA) |
|---|---|---|---|---|---|---|
| `nexus-api` | Go | 250m | 1000m | 128Mi | 512Mi | 2 → 10 |
| `nexus-socket` | Node.js | 500m | 2000m | 256Mi | 1Gi | 2 → 10 |
| `nexus-rag` | Python | 1000m | 4000m | 2Gi | 8Gi | 2 → 6 |
| `nexus-ai-gateway` | Go | 250m | 1000m | 128Mi | 512Mi | 2 → 8 |
| `nexus-ai-worker` | Go | 500m | 2000m | 512Mi | 2Gi | 2 → 8 |
| `nexus-billing` | Go | 250m | 1000m | 128Mi | 512Mi | 2 → 4 |
| `nexus-compute` | C++ | 500m | 2000m | 1Gi | 4Gi | 2 → 6 |

---

## 4. Repository Structure & gRPC Proto

### Mono-Repo Structure

All services, shared protobuf definitions, infrastructure-as-code, and the frontend live in a single repository for atomic commits, shared CI, and simplified dependency management.

```text
nexus/
├── services/
│   ├── nexus-api/              (Go — Gin/Echo)
│   │   ├── cmd/
│   │   ├── internal/
│   │   ├── Dockerfile
│   │   └── go.mod
│   ├── nexus-socket/           (Node.js — Socket.IO)
│   │   ├── src/
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── nexus-ai-gateway/       (Go)
│   │   ├── cmd/
│   │   ├── internal/
│   │   └── go.mod
│   ├── nexus-ai-worker/        (Go)
│   │   ├── cmd/
│   │   ├── internal/
│   │   └── go.mod
│   ├── nexus-billing/          (Go)
│   │   ├── cmd/
│   │   ├── internal/
│   │   └── go.mod
│   └── nexus-rag/              (Python — FastAPI + gRPC)
│       ├── app/
│       ├── Dockerfile
│       └── requirements.txt
│   └── nexus-compute/          (C++ — gRPC + Custom Allocators)
│       ├── src/
│       ├── include/
│       ├── CMakeLists.txt
│       ├── vcpkg.json
│       └── Dockerfile
├── proto/                      (Shared gRPC definitions)
│   ├── rag/
│   │   └── rag.proto
│   ├── gateway/
│   │   └── gateway.proto
│   ├── billing/
│   │   └── billing.proto
│   ├── compute/
│   │   └── compute.proto
│   └── buf.yaml
├── client/                     (React 19 + Vite)
│   ├── src/
│   └── package.json
├── infra/                      (Terraform / Pulumi)
│   ├── gke/
│   ├── pubsub/
│   ├── redis/
│   └── cloudstorage/
├── scripts/
│   ├── migrate/                (Data migration scripts)
│   └── seed/
├── docker-compose.yml          (Local development)
├── Makefile
└── README.md
```

### Shared gRPC Proto Definitions

All inter-service communication uses **Protocol Buffers** managed with **Buf**. Proto files live in `/proto` and are compiled into Go and Python stubs during CI.

```protobuf
// proto/rag/rag.proto
syntax = "proto3";
package nexus.rag;

service RAGService {
  rpc RetrieveContext (RetrieveRequest) returns (RetrieveResponse);
  rpc EmbedAndStore (EmbedRequest) returns (EmbedResponse);
}

message RetrieveRequest {
  string query = 1;
  string tenant_id = 2;
  string group_id = 3;
  string chat_id = 4;
  int32 top_k = 5;
}

message RetrieveResponse {
  repeated ContextChunk chunks = 1;
  int32 total_tokens = 2;
}

message ContextChunk {
  string content = 1;
  float score = 2;
  string source_user_id = 3;
}
```

```protobuf
// proto/gateway/gateway.proto
syntax = "proto3";
package nexus.gateway;

service AIGatewayService {
  rpc GenerateResponse (GenerateRequest) returns (GenerateResponse);
  rpc StreamResponse (GenerateRequest) returns (stream GenerateChunk);
}

message GenerateRequest {
  string prompt = 1;
  string context = 2;
  string model_hint = 3;   // "fast", "quality", "code", or specific model
  string tenant_id = 4;
}

message GenerateResponse {
  string content = 1;
  string model_used = 2;
  int32 prompt_tokens = 3;
  int32 completion_tokens = 4;
}

message GenerateChunk {
  string delta = 1;         // Incremental text chunk
  bool is_final = 2;
  string model_used = 3;
}
```

---

## 5. Multi-Tenant SaaS Data Model

Every document in the system carries `tenant_id` and `workspace_id` to enable strict data isolation for organizations, teams, and enterprise customers.

### Entity Relationship Diagram

```mermaid
erDiagram
    TENANT {
        string id PK
        string name
        string plan "free | pro | enterprise"
        object billing
        datetime created_at
    }

    WORKSPACE {
        string id PK
        string tenant_id FK
        string name
        string slug UK
        object settings
        datetime created_at
    }

    USER {
        string id PK
        string firebase_uid UK
        string email UK
        string display_name
        string avatar_url
        string system_role "admin | user"
        datetime created_at
        datetime last_seen
    }

    WORKSPACE_MEMBER {
        string workspace_id FK
        string user_id FK
        string role "owner | admin | member | viewer"
        datetime joined_at
    }

    GROUP {
        string id PK
        string tenant_id FK
        string workspace_id FK
        string name
        string owner_id FK
        bool ai_enabled
        datetime created_at
    }

    CHAT {
        string id PK
        string tenant_id FK
        string workspace_id FK
        string group_id FK
        string title
        datetime created_at
    }

    MESSAGE {
        string id PK
        string tenant_id FK
        string workspace_id FK
        string group_id FK
        string chat_id FK
        string user_id FK
        string role "user | assistant"
        string content
        object reply_to
        array reactions
        bool is_deleted
        bool is_edited
        datetime created_at
    }

    AUDIT_LOG {
        string id PK
        string tenant_id FK
        string user_id FK
        string action
        object metadata
        string ip_address
        datetime created_at
    }

    TENANT ||--o{ WORKSPACE : "has"
    WORKSPACE ||--o{ WORKSPACE_MEMBER : "has"
    USER ||--o{ WORKSPACE_MEMBER : "joins"
    WORKSPACE ||--o{ GROUP : "contains"
    GROUP ||--o{ CHAT : "contains"
    CHAT ||--o{ MESSAGE : "has"
    USER ||--o{ MESSAGE : "sends"
    TENANT ||--o{ AUDIT_LOG : "generates"
```

### PostgreSQL Row-Level Security (RLS) & Indexes

```sql
-- RLS Policy (Enforced globally)
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messages
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Messages (Time-based Partitioning + JSONB for flexible schema)
-- Note: Table is created with PARTITION BY RANGE (created_at)
-- e.g., messages_2026_01, messages_2026_02
CREATE INDEX idx_msg_room_time ON messages(tenant_id, group_id, chat_id, created_at DESC);
CREATE INDEX idx_msg_fulltext ON messages USING GIN(to_tsvector('english', content));

-- Users
CREATE UNIQUE INDEX idx_users_firebase_uid ON users(firebase_uid);
CREATE UNIQUE INDEX idx_users_email ON users(email);

-- Workspaces
CREATE INDEX idx_workspaces_tenant ON workspaces(tenant_id);
CREATE UNIQUE INDEX idx_workspaces_slug ON workspaces(slug);

-- Groups
CREATE INDEX idx_groups_tenant_workspace ON groups(tenant_id, workspace_id);

-- Audit Logs (Time-based partitioning for TTL)
CREATE INDEX idx_audit_tenant_user_time ON audit_logs(tenant_id, user_id, created_at DESC);
```

### RBAC Permissions

| Action | Owner | Admin | Member | Viewer |
|---|---|---|---|---|
| Delete workspace | ✅ | ❌ | ❌ | ❌ |
| Manage billing | ✅ | ❌ | ❌ | ❌ |
| Delete group/chat | ✅ | ✅ | ❌ | ❌ |
| Remove member | ✅ | ✅ | ❌ | ❌ |
| Invite member | ✅ | ✅ | ✅ | ❌ |
| Send message | ✅ | ✅ | ✅ | ❌ |
| Read messages | ✅ | ✅ | ✅ | ✅ |
| Toggle AI | ✅ | ✅ | ❌ | ❌ |

---

## 6. Real-Time Messaging Flow

### Non-Blocking AI with Redis Streams + Streaming

```mermaid
sequenceDiagram
    participant C as Client
    participant SIO as nexus-socket (Node.js)
    participant RED as Upstash Redis
    participant STRM as Redis Streams
    participant WRK as nexus-ai-worker (Go)
    participant RAG as nexus-rag (Python)
    participant AIGW as nexus-ai-gateway (Go)
    participant LLM as LLM Provider
    participant P as Cloud SQL (PostgreSQL)
    participant Q as Qdrant

    C->>SIO: send_message {trigger_ai: true, tenant_id}
    SIO->>P: insert user message
    SIO->>RED: PUBLISH room:{chat_id} (Socket.IO adapter)
    RED-->>SIO: fanout to all nexus-socket pods
    SIO-->>C: new_message (instant, <50ms)

    SIO->>STRM: XADD stream:ai.inference {task payload}
    Note over SIO,STRM: Returns immediately — socket is unblocked

    STRM->>WRK: XREADGROUP (ai-workers consumer group)
    WRK->>RAG: gRPC: RetrieveContext(query, group_id, chat_id)
    RAG->>Q: vector search (BGE-M3 embedding)
    Q-->>RAG: top-50 candidates
    RAG->>RAG: BGE-Reranker → top-5 context chunks
    RAG-->>WRK: RetrievalResult {context, scores}

    WRK->>AIGW: gRPC stream: StreamResponse(prompt, context)
    AIGW->>LLM: SSE / streaming API call
    loop Token-by-token streaming
        LLM-->>AIGW: chunk {delta}
        AIGW-->>WRK: GenerateChunk {delta}
        WRK->>RED: PUBLISH room:{chat_id}:ai_stream {delta}
        RED-->>SIO: fanout via adapter
        SIO-->>C: ai_stream_chunk {delta, is_final: false}
    end
    AIGW-->>WRK: GenerateChunk {is_final: true, model_used, tokens}

    WRK->>P: insert AI message (tenant_id, role: assistant)
    WRK->>RED: PUBLISH room:{chat_id}:ai_stream {is_final: true}
    SIO-->>C: ai_stream_chunk {is_final: true}

    WRK->>STRM: XADD stream:embed.messages {content, metadata}
    Note over WRK,STRM: Async embedding pipeline
    STRM->>WRK: XREADGROUP consume embed.messages
    WRK->>RAG: gRPC: EmbedAndStore(content, metadata)
    RAG->>Q: upsert vector point
```

### Socket.IO Horizontal Scaling via Redis Adapter

```mermaid
graph LR
    subgraph Clients
        C1["Client A\n(connected to Pod 1)"]
        C2["Client B\n(connected to Pod 2)"]
        C3["Client C\n(connected to Pod 2)"]
    end

    subgraph Pods
        P1["nexus-socket Pod 1"]
        P2["nexus-socket Pod 2"]
    end

    subgraph Redis
        PUB["Upstash Redis\nPubSub Adapter Channel"]
    end

    C1 <--> P1
    C2 <--> P2
    C3 <--> P2

    P1 <-->|subscribe/publish| PUB
    P2 <-->|subscribe/publish| PUB
```

When Pod 1 emits to room `grp:chat_id`, Redis broadcasts the event to Pod 2 as well. All clients in the room receive the message regardless of which pod they are connected to.

---

## 7. AI Streaming Response Architecture

Users expect a **typewriter-style streaming effect** when AI responds, not a 5-15 second blank wait. The architecture supports token-by-token streaming from LLM provider all the way to the browser.

```mermaid
graph LR
    LLM["LLM Provider\n(SSE stream)"] -->|chunk| AIGW["nexus-ai-gateway\n(gRPC stream)"]
    AIGW -->|GenerateChunk| WRK["nexus-ai-worker\n(Go consumer)"]
    WRK -->|PUBLISH| RED["Redis PubSub\nroom:{chat_id}:ai_stream"]
    RED -->|fanout| SIO["nexus-socket\n(Node.js)"]
    SIO -->|Socket.IO emit| C["Client\n(React)"]
```

### Client-Side Handling

```javascript
// client/src/hooks/useAIStream.ts
socket.on('ai_stream_chunk', ({ chatId, delta, isFinal, messageId }) => {
  if (isFinal) {
    // Mark message as complete, stop typing indicator
    dispatch({ type: 'AI_STREAM_COMPLETE', chatId, messageId });
  } else {
    // Append delta to the in-progress AI message
    dispatch({ type: 'AI_STREAM_DELTA', chatId, messageId, delta });
  }
});
```

### How It Works End-to-End

1. **LLM Provider** streams tokens via SSE (OpenAI, Anthropic) or chunked response (Gemini).
2. **`nexus-ai-gateway`** receives the stream and forwards each chunk via **gRPC server streaming** (`StreamResponse` RPC).
3. **`nexus-ai-worker`** receives each `GenerateChunk` and publishes it to a Redis PubSub channel `room:{chat_id}:ai_stream`.
4. **`nexus-socket`** (Node.js) receives the Redis message via the adapter and emits `ai_stream_chunk` to all clients in the room.
5. **Client** renders tokens progressively with a typing animation.
6. When `is_final: true` arrives, the worker inserts the complete message into Cloud SQL (PostgreSQL).

---

## 8. Authentication — Firebase

Custom JWT validation, password hashing, and OTP systems are **completely replaced** by Firebase Authentication.

```mermaid
    sequenceDiagram
    participant C as Client (React)
    participant FB as Firebase Auth
    participant API as nexus-api (Go)
    participant RED as Upstash Redis
    participant M as Cloud SQL (PostgreSQL)
    participant SIO as Socket.IO Server
    Note over C,M: Login
    C->>FB: signInWithPopup(GoogleAuthProvider)
    FB-->>C: Firebase ID Token (JWT)
    C->>API: POST /api/auth/session {id_token}
    API->>FB: admin.VerifyIDToken(id_token)
    FB-->>API: decoded {uid, email, name, picture}
    API->>M: upsert user (firebase_uid → user profile)
    API->>RED: SET session:{uid} → user_data (EX 900)
    API-->>C: Set-Cookie: session_token&#59; HttpOnly&#59; Secure&#59; SameSite=Strict
    Note over C,M: Authenticated Request
    C->>API: GET /api/workspaces (cookie sent automatically)
    API->>RED: GET session:{uid} (cache hit → <1ms)
    RED-->>API: user_data
    API->>M: query workspaces (tenant_id filter)
    API-->>C: 200 workspaces[]
    Note over C,SIO: WebSocket Auth
    C->>SIO: connect {auth: {token: firebase_id_token}}
    SIO->>FB: admin.VerifyIDToken(token)
    FB-->>SIO: valid → allow connection
```

### Supported Providers
- **Google OAuth** — Primary enterprise SSO.
- **GitHub OAuth** — Developer-facing login.
- **Email/Password** — Fallback with Firebase-managed password reset and email verification.

### Why Firebase over Custom JWT?
| Concern | Custom JWT | Firebase Auth |
|---|---|---|
| Password storage | You manage hashing (bcrypt) | Firebase handles it |
| OAuth integration | Manual per-provider | Built-in |
| Email verification | Build OTP system | Free, automatic |
| Token refresh | Build rotation logic | Firebase SDK handles it |
| MFA | Build from scratch | One config toggle |
| Security patching | Your responsibility | Google's responsibility |

---

## 9. AI Gateway — Multi-Model Routing

### `nexus-ai-gateway` Service

A centralized Go proxy service acting as the **single egress point** for all LLM interactions across the entire platform.

```mermaid
graph TB
    subgraph Gateway["nexus-ai-gateway"]
        ROUTER["Model Router\n━━━━━━━━━━━\n• Task complexity scoring\n• Cost-per-token tracking\n• Tenant quota enforcement"]
        CACHE["Response Cache\n━━━━━━━━━━━\n• SHA-256 prompt hashing\n• Redis-backed (TTL: 1h)\n• Cache hit → skip LLM call"]
        FALLBACK["Fallback Chain\n━━━━━━━━━━━\n• Primary → Secondary → Tertiary\n• Circuit breaker per provider\n• Automatic failover"]
        METER["Usage Metering\n━━━━━━━━━━━\n• Token counts per tenant\n• Cost aggregation\n• BigQuery export"]
    end

    subgraph Providers["LLM Providers"]
        GEM["Google Gemini\n(1.5 Pro / Flash / 2.0)"]
        CLA["Anthropic Claude\n(3.5 Sonnet / Haiku)"]
        GPT["OpenAI GPT\n(4o / 4o-mini)"]
        DS["DeepSeek\n(V3 / Coder)"]
        GMA["Google Gemma\n(2 / 3 open-weight)"]
    end

    ROUTER --> CACHE
    CACHE -->|miss| FALLBACK
    FALLBACK --> GEM & CLA & GPT & DS & GMA
    FALLBACK --> METER
```

### Model Routing Strategy

| Task Type | Primary Model | Fallback | Rationale |
|---|---|---|---|
| Simple Q&A / chat | Gemma 3 / DeepSeek V3 | Gemini Flash | Low cost, fast |
| Complex reasoning | Gemini 1.5 Pro | Claude 3.5 Sonnet | High quality |
| Code generation | DeepSeek Coder | GPT-4o | Specialized |
| Summarization | Gemini Flash | Claude Haiku | Speed + cost |
| Enterprise / sensitive | Claude 3.5 Sonnet | GPT-4o | Safety filters |

### Circuit Breaker Logic
Each provider is wrapped in a circuit breaker (Go `sony/gobreaker`):
- **Closed** (healthy): Requests flow normally.
- **Open** (tripped): After 5 consecutive failures, stop sending for 30s → route to fallback.
- **Half-Open**: After cooldown, let 1 request through to test recovery.

---

## 10. RAG Pipeline — Dedicated Retrieval Service

### `nexus-rag` Service (Python)

Instead of a simplistic `API → Qdrant → LLM` flow, the retrieval pipeline is professionalized into a **multi-stage pipeline** running inside a dedicated **Python** service (FastAPI + gRPC). Python is chosen here because BGE-M3, BGE-Reranker, and the entire HuggingFace/PyTorch inference stack run natively in Python without CGo overhead.

```mermaid
graph TD
    REQ["nexus-ai-worker (Go)\n(gRPC: RetrieveContext)"]
    
    subgraph RAG["nexus-rag Pipeline (Python)"]
        EMB["1. Embed Query\n(BGE-M3)\nDense + Sparse vectors"]
        RET["2. Retrieve\n(Qdrant hybrid search)\nFetch top-50 candidates"]
        RERANK["3. Rerank\n(BGE-Reranker)\nCross-encoder scoring"]
        SELECT["4. Select\nTop-5 context chunks\nScore threshold > 0.7"]
        BUILD["5. Build Prompt\nSystem + Context + Query\nToken budget management"]
    end

    REQ --> EMB --> RET --> RERANK --> SELECT --> BUILD
    BUILD --> RESP["Return to nexus-ai-worker\n{context_chunks, total_tokens}"]
    
    RET <--> QDR["Qdrant Cloud"]
```

### Models Used

| Component | Model | Purpose |
|---|---|---|
| Embedder | **BGE-M3** | Multilingual, multi-granularity; produces dense + sparse vectors for hybrid search |
| Reranker | **BGE-Reranker-v2-m3** | Cross-encoder that scores query-document relevance with high accuracy |
| Vector DB | **Qdrant Cloud** | HNSW indexing, payload filtering, named vectors, built-in quantization |

### Qdrant Collection Schema

```json
{
  "collection_name": "nexus_messages",
  "vectors_config": {
    "dense": { "size": 1024, "distance": "Cosine" },
    "sparse": { "index": { "on_disk": true } }
  },
  "payload_schema": {
    "tenant_id":    "keyword",
    "workspace_id": "keyword",
    "group_id":     "keyword",
    "chat_id":      "keyword",
    "user_id":      "keyword",
    "role":         "keyword",
    "content":      "text",
    "created_at":   "integer"
  }
}
```

All vector searches are **pre-filtered** by `tenant_id` + `group_id` + `chat_id` to ensure strict multi-tenant data isolation at the vector layer.

---

## 11. Caching Strategy — Upstash Redis

**Upstash Redis** (serverless Redis) serves as the unified caching, pub/sub, message queue (Streams), and rate limiting layer.

### Cache Taxonomy

```mermaid
graph TD
    subgraph L1["L1 — In-Process (Go / Python)"]
        IPC["sync.Map (Go) / lru_cache (Python)\n• Config values\n• Compiled regexes\n• Firebase public keys\nTTL: process lifetime"]
    end

    subgraph L2["L2 — Upstash Redis (Shared)"]
        SESS["Session Cache\nKey: session:{firebase_uid}\nTTL: 900s"]
        RATE["Rate Limit Counters\nKey: rl:{tenant}:{ip}:{endpoint}\nTTL: 60s (sliding window)"]
        PRES["User Presence\nKey: presence:{workspace}:{user}\nTTL: 30s (heartbeat)"]
        AICC["AI Response Cache\nKey: ai:{sha256(prompt)}\nTTL: 3600s"]
        MSGC["Message Page Cache\nKey: msg:{tenant}:{group}:{chat}:p{n}\nTTL: 60s"]
        GRPC["Group Members Cache\nKey: grp:{tenant}:{group}:members\nTTL: 300s"]
        STRM["Message Queue (Streams)\nKey: stream:ai.inference\nKey: stream:embed.messages\nKey: stream:notifications"]
    end

    subgraph L3["L3 — Cloud SQL PostgreSQL (Source of Truth)"]
        MDB["All persistent data"]
    end

    subgraph L4["L4 — Qdrant Cloud (Vector)"]
        QDR["Semantic search results\nPayload-cached in Qdrant"]
    end

    L1 --> L2 --> L3
    L2 --> L4
```

### Redis Key Schema (Complete)

```text
# ── Sessions ──
session:{firebase_uid}                → JSON user payload        EX 900
session:{firebase_uid}:perms          → JSON RBAC permissions    EX 900

# ── Rate Limiting (Sorted Set — Sliding Window) ──
rl:{tenant_id}:{ip}:{endpoint}        → ZSET of timestamps      EX 60
rl:ai:{tenant_id}:{user_id}           → ZSET of timestamps      EX 3600

# ── Presence ──
presence:{workspace_id}:{user_id}     → {status, room, ts}      EX 30
typing:{chat_id}:{user_id}            → "1"                     EX 5

# ── Socket.IO Adapter ──
nexus-sio:{channel}                   → PubSub adapter channels

# ── AI Response Cache ──
ai:{sha256(prompt[:512])}             → {answer, model, tokens}  EX 3600

# ── Message Pages ──
msg:{tenant}:{group}:{chat}:p{n}      → JSON messages[]          EX 60

# ── Message Queue (Streams) ──
stream:ai.inference                      → XADD task payloads       Consumer group: ai-workers
stream:embed.messages                    → XADD embed payloads      Consumer group: embed-workers
stream:notifications                     → XADD notif payloads      Consumer group: notif-workers
stream:webhooks                          → XADD webhook payloads    Consumer group: webhook-workers
stream:deadletter                        → Failed messages (7d)     No consumer group
grp:{tenant}:{group}:members          → JSON members[]           EX 300
```

### Cache-Aside Pattern

```mermaid
flowchart TD
    REQ["GET /api/messages?chat_id=X&page=1"]
    RCHK{"Redis HIT?\nmsg:{tenant}:{group}:{chat}:p1"}
    RGET["Return cached JSON\n(~1ms)"]
    MGET["Query Cloud SQL\n(~10-30ms)"]
    RSET["SET Redis key\nEX 60s"]
    RESP["Return to client"]
    INVAL["On new message:\nDEL msg:{tenant}:{group}:{chat}:*"]

    REQ --> RCHK
    RCHK -->|Hit| RGET --> RESP
    RCHK -->|Miss| MGET --> RSET --> RESP
    INVAL -.->|Invalidation| RCHK
```

---

## 12. Database Layer — Cloud SQL (PostgreSQL)

### Cluster Configuration
- **Engine**: Cloud SQL for PostgreSQL 16 (fully managed on GCP).
- **Topology**: Primary instance for writes + read replica for horizontal read scaling.
- **Features**: Automated backups, point-in-time recovery, IAM integration, native Row-Level Security (RLS).

```mermaid
graph LR
    subgraph CloudSQL["Cloud SQL PostgreSQL"]
        PRI["Primary Instance\n(Writes)"]
        RP["Read Replica\n(Auto-scaling reads)"]
        
        PRI -.->|Replication| RP
    end
```

### Go Database Client Configuration (pgx)

```go
// internal/database/postgres.go
func NewPostgresPool(ctx context.Context) (*pgxpool.Pool, error) {
    config, err := pgxpool.ParseConfig(os.Getenv("POSTGRES_URI"))
    if err != nil {
        return nil, err
    }
    
    config.MaxConns = 100
    config.MinConns = 10
    config.MaxConnIdleTime = time.Minute * 5
        
    pool, err := pgxpool.NewWithConfig(ctx, config)
    if err != nil {
        return nil, err
    }
    return pool, nil
}
```

---

## 13. Vector Search — Qdrant Cloud

### Why Qdrant over MongoDB Atlas Vector Search?

| Feature | MongoDB Atlas VS | Qdrant Cloud |
|---|---|---|
| Hybrid search (dense + sparse) | ❌ | ✅ |
| Pre-filter before search | Limited | ✅ Full payload filtering |
| Query latency (1M vectors) | ~50-100ms | ~5-10ms (HNSW) |
| Quantization | ❌ | ✅ Binary / Scalar / Product |
| Multi-vector support | ❌ | ✅ Named vectors |
| Vendor lock-in | Atlas-only | Self-hosted or cloud |
| Cost at scale | High (Atlas tier) | Lower |

### Migration Path
1. Deploy Qdrant Cloud cluster in same GCP region.
2. `nexus-rag` service embeds all existing messages via BGE-M3.
3. Upsert vectors to Qdrant with full payload (tenant_id, group_id, etc.).
4. Switch `nexus-rag` retrieval to Qdrant.
5. Remove Atlas Vector Search indexes.

---

## 14. File Storage — Google Cloud Storage

### Bucket Structure

```text
gs://nexus-prod-storage/
├── avatars/{tenant_id}/{user_id}/{timestamp}.webp
├── avatars/{tenant_id}/{user_id}/{timestamp}_thumb.webp
├── documents/{tenant_id}/{workspace_id}/
├── attachments/{tenant_id}/{chat_id}/{message_id}/
├── exports/{tenant_id}/{export_id}.zip
└── workspace-files/{tenant_id}/{workspace_id}/
```

### Upload Flow

```mermaid
flowchart TD
    C["Client\n(browser)"]
    API["nexus-api"]
    SIGN["Generate Signed URL\n(PUT, 15min expiry)"]
    GCS["Google Cloud Storage\nBucket: nexus-prod-storage"]
    CDN["Cloud CDN\nhttps://cdn.nexusainow.online/..."]
    P["Cloud SQL\navatar_url: CDN URL"]

    C -->|"POST /api/upload/signed-url"| API
    API --> SIGN
    SIGN -->|"{ signed_url, cdn_url }"| C
    C -->|"PUT (direct upload)"| GCS
    GCS --> CDN
    C -->|"PATCH /api/profile {avatar_url}"| API
    API --> M
```

**Key design**: The client uploads **directly to GCS** via a signed URL. The API server never touches the file bytes, keeping it lightweight.

### CDN Serving
All GCS objects are served through **Cloud CDN** with:
- `Cache-Control: public, max-age=31536000` for immutable assets.
- Signed URLs for private/temporary downloads.

---

## 15. Async Job Processing — Redis Streams

### Stream & Consumer Group Architecture

```mermaid
graph TB
    subgraph Producers
        SIO["nexus-socket"]
        API["nexus-api"]
        BILL["nexus-billing"]
    end

    subgraph RedisStreams["Upstash Redis — Streams"]
        S1["Stream: stream:ai.inference\n(AI generation requests)"]
        S2["Stream: stream:embed.messages\n(Vector embedding jobs)"]
        S3["Stream: stream:notifications\n(Email / Push / Slack)"]
        S4["Stream: stream:webhooks\n(Enterprise event delivery)"]
        S5["Stream: stream:billing.events\n(Usage metering)"]
        DLQ["Stream: stream:deadletter\n(Failed jobs, 7d retention)"]

        CG1["Consumer Group: ai-workers\n(nexus-ai-worker pods)"]
        CG2["Consumer Group: embed-workers\n(nexus-ai-worker pods)"]
        CG3["Consumer Group: notif-workers\n(nexus-ai-worker pods)"]
        CG4["Consumer Group: webhook-workers\n(nexus-api pods)"]
        CG5["Consumer Group: billing-workers\n(nexus-billing pods)"]
    end

    subgraph Workers["nexus-ai-worker Pods"]
        W["Go Worker Pool\n• Concurrent goroutines\n• XACK per message\n• Max 3 retries → DLQ\n• XCLAIM for stuck messages"]
    end

    SIO --> S1
    API --> S1
    SIO & API --> S2 & S3

    S1 --> CG1 --> W
    S2 --> CG2 --> W
    S3 --> CG3 --> W

    W -->|"3 failures"| DLQ
```

### Go Redis Streams Consumer

```go
// internal/worker/consumer.go
func (w *Worker) Start(ctx context.Context) error {
    consumerName := fmt.Sprintf("worker-%s", os.Getenv("HOSTNAME"))

    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
        }

        // Block-read from stream with consumer group
        streams, err := w.rdb.XReadGroup(ctx, &redis.XReadGroupArgs{
            Group:    "ai-workers",
            Consumer: consumerName,
            Streams:  []string{"stream:ai.inference", ">"},
            Count:    10,
            Block:    5 * time.Second,
        }).Result()

        if err == redis.Nil {
            continue // No new messages, loop back
        }
        if err != nil {
            log.Error("stream read error", "error", err)
            time.Sleep(time.Second)
            continue
        }

        for _, stream := range streams {
            for _, msg := range stream.Messages {
                go w.processMessage(ctx, msg)
            }
        }
    }
}

func (w *Worker) processMessage(ctx context.Context, msg redis.XMessage) {
    var task AIInferenceTask
    if err := json.Unmarshal([]byte(msg.Values["payload"].(string)), &task); err != nil {
        log.Error("invalid message", "id", msg.ID, "error", err)
        w.rdb.XAck(ctx, "stream:ai.inference", "ai-workers", msg.ID)
        return
    }

    if err := w.processInference(ctx, task); err != nil {
        // Check retry count from message metadata
        retries := w.getRetryCount(ctx, msg.ID)
        if retries >= 3 {
            w.sendToDeadLetter(ctx, msg, err)
            w.rdb.XAck(ctx, "stream:ai.inference", "ai-workers", msg.ID)
        }
        // Don't ACK — message stays pending for XCLAIM recovery
        return
    }
    w.rdb.XAck(ctx, "stream:ai.inference", "ai-workers", msg.ID)
}
```

### Dead-Letter Recovery (XPENDING + XCLAIM)

Stuck or failed messages are recovered via a background goroutine:

```go
// internal/worker/recovery.go
func (w *Worker) RecoverStuckMessages(ctx context.Context) {
    ticker := time.NewTicker(30 * time.Second)
    defer ticker.Stop()

    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            // Find messages pending for > 60 seconds
            pending, _ := w.rdb.XPendingExt(ctx, &redis.XPendingExtArgs{
                Stream: "stream:ai.inference",
                Group:  "ai-workers",
                Start:  "-",
                End:    "+",
                Count:  100,
                Idle:   60 * time.Second,
            }).Result()

            for _, p := range pending {
                if p.RetryCount >= 3 {
                    // Move to dead-letter stream
                    msgs, _ := w.rdb.XRangeN(ctx, "stream:ai.inference", p.ID, p.ID, 1).Result()
                    if len(msgs) > 0 {
                        w.rdb.XAdd(ctx, &redis.XAddArgs{
                            Stream: "stream:deadletter",
                            Values: msgs[0].Values,
                        })
                    }
                    w.rdb.XAck(ctx, "stream:ai.inference", "ai-workers", p.ID)
                } else {
                    // Reclaim for this consumer
                    w.rdb.XClaim(ctx, &redis.XClaimArgs{
                        Stream:   "stream:ai.inference",
                        Group:    "ai-workers",
                        Consumer: fmt.Sprintf("worker-%s", os.Getenv("HOSTNAME")),
                        MinIdle:  60 * time.Second,
                        Messages: []string{p.ID},
                    })
                }
            }
        }
    }
}
```

### Why Redis Streams over Pub/Sub / Kafka?

| Feature | Redis Streams | Google Pub/Sub | Kafka |
|---|---|---|---|
| Ops burden | Low (managed via Upstash) | Zero (fully managed) | High (ZooKeeper/KRaft) |
| Consumer groups | ✅ Built-in (XREADGROUP) | ✅ Subscriptions | ✅ Consumer groups |
| Message persistence | ✅ Persisted until trimmed | ✅ 7-day retention | ✅ Configurable |
| Dead-letter handling | XPENDING + XCLAIM (manual) | ✅ Native DLQ | Manual topic setup |
| Retry with backoff | Manual (via retry count) | ✅ Built-in | Consumer-side logic |
| Unified with cache | ✅ Same Redis instance | ❌ Separate service | ❌ Separate cluster |
| Cost | $0 free tier / pay-per-cmd | Pay per message | High (always-on brokers) |
| Vendor lock-in | None (standard Redis) | GCP-only | None |
| Delivery guarantee | At-least-once | At-least-once | At-least-once / Exactly-once |

---

## 16. API Gateway & Rate Limiting

### Rate Limiting Tiers (Redis Sliding Window)

| Tier | Limit | Window | Redis Key |
|---|---|---|---|
| Unauthenticated | 20 req | 60s | `rl:anon:{ip}` |
| Authenticated REST | 120 req | 60s | `rl:{tenant}:{user}:rest` |
| AI inference | 20 req | 3600s | `rl:ai:{tenant}:{user}` |
| Socket events | 5 events | 1s | `rl:ws:{sid}` |
| File upload | 10 req | 3600s | `rl:upload:{tenant}:{user}` |
| Auth endpoints | 5 req | 300s | `rl:auth:{ip}` |

### Rate Limiter Implementation (Go)

```go
// internal/middleware/ratelimit.go
func CheckRateLimit(ctx context.Context, rdb *redis.Client,
    key string, maxCalls int, windowSec int64) error {
    
    now := float64(time.Now().UnixNano()) / 1e9
    pipe := rdb.Pipeline()
    
    pipe.ZRemRangeByScore(ctx, key, "0", fmt.Sprintf("%f", now-float64(windowSec)))
    pipe.ZAdd(ctx, key, redis.Z{Score: now, Member: fmt.Sprintf("%f", now)})
    countCmd := pipe.ZCard(ctx, key)
    pipe.Expire(ctx, key, time.Duration(windowSec)*time.Second)
    
    if _, err := pipe.Exec(ctx); err != nil {
        return err
    }
    
    if countCmd.Val() > int64(maxCalls) {
        return ErrRateLimitExceeded
    }
    return nil
}
```

### Circuit Breaker for External APIs

Each external service call (LLM providers, Qdrant, Firebase) is wrapped using `sony/gobreaker`:

```go
cb := gobreaker.NewCircuitBreaker(gobreaker.Settings{
    Name:        "gemini-api",
    MaxRequests: 1,                       // Half-open: allow 1 test request
    Interval:    60 * time.Second,        // Reset failure count window
    Timeout:     30 * time.Second,        // Open → Half-open cooldown
    ReadyToTrip: func(counts gobreaker.Counts) bool {
        return counts.ConsecutiveFailures > 5
    },
})
```

---

## 17. Security, GDPR & Compliance

### Security Architecture

```mermaid
graph TD
    subgraph EdgeSecurity["Edge Security"]
        CA["Cloud Armor\n━━━━━━━━━\n• WAF rules (OWASP Top 10)\n• DDoS protection\n• Bot detection\n• Geo-blocking\n• IP allow/deny lists"]
    end

    subgraph TransportSecurity["Transport"]
        TLS["TLS 1.3 everywhere\n• Managed certs (Google-managed)\n• HSTS: max-age=31536000"]
    end

    subgraph AppSecurity["Application"]
        HEADS["Security Headers\n• CSP · X-Frame-Options · HSTS\n• X-Content-Type-Options\n• Referrer-Policy"]
        INPUT["Input Validation\n• Request size limits\n• Content-type enforcement\n• DOMPurify (frontend)"]
        AUTHZ["Authorization\n• Firebase JWT verification\n• Tenant isolation middleware\n• RBAC enforcement"]
    end

    subgraph SecretSecurity["Secrets"]
        SM["Secret Manager\n━━━━━━━━━\nStored:\n• POSTGRES_URI\n• QDRANT_KEY\n• GEMINI_KEY\n• CLAUDE_KEY\n• OPENAI_KEY\n• DEEPSEEK_KEY\n• SMTP_KEYS\n• FIREBASE_SA\n• UPSTASH_REDIS_URL"]
    end

    subgraph ContainerSecurity["Container"]
        CONT["• Non-root user (uid 1000)\n• Read-only root filesystem\n• Distroless base image\n• Trivy scan in CI\n• No shell in production image"]
    end

    EdgeSecurity --> TransportSecurity --> AppSecurity
    AppSecurity --> SecretSecurity
    AppSecurity --> ContainerSecurity
```

### GDPR & Data Compliance

As a multi-tenant SaaS serving enterprise customers, Nexus must comply with GDPR and regional data protection laws.

| Requirement | Implementation |
|---|---|
| **Right to Access** (Art. 15) | `GET /api/tenant/{id}/export` — generates a ZIP of all tenant data from Cloud SQL + Qdrant + GCS |
| **Right to Erasure** (Art. 17) | `DELETE /api/tenant/{id}` — cascading delete across Cloud SQL, Qdrant vectors, GCS files, BigQuery rows, and Redis cache |
| **Right to Portability** (Art. 20) | Export in JSON/CSV format via `nexus-api` |
| **Data Residency** | Deploy tenant data in region-specific Cloud SQL instances and GCS buckets (e.g., `eu-west1` for EU tenants) |
| **Data Processing Agreement** | Template DPA available for enterprise tenants |
| **Consent Management** | Firebase Auth handles consent for OAuth; custom consent tracking in `audit_logs` |
| **Breach Notification** | Cloud Error Reporting + PagerDuty alert within 72 hours |
| **Data Minimization** | TTL on audit_logs (90 days), message soft-delete with hard purge after 30 days |

### Tenant Data Deletion Flow

```mermaid
flowchart TD
    REQ["DELETE /api/tenant/{id}"] --> AUTH["Verify: Owner role"]
    AUTH --> GRACE["Set 30-day grace period\n(reversible)"]
    GRACE --> PDB["Delete from Cloud SQL\n• users, workspaces, groups\n• chats, messages\n• audit_logs"]
    GRACE --> QDRANT["Delete from Qdrant\nfilter: tenant_id={id}"]
    GRACE --> GCS_DEL["Delete from GCS\ngs://bucket/{tenant_id}/"]
    GRACE --> BQ_DEL["Delete from BigQuery\nWHERE tenant_id={id}"]
    GRACE --> REDIS_DEL["Flush Redis keys\npattern: *{tenant_id}*"]
    GRACE --> FB_DEL["Disable Firebase users\n(batch API)"]
```

### Security Headers Middleware (Go)

```go
// internal/middleware/security.go
func SecurityHeaders() gin.HandlerFunc {
    return func(c *gin.Context) {
        c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
        c.Header("X-Content-Type-Options", "nosniff")
        c.Header("X-Frame-Options", "DENY")
        c.Header("X-XSS-Protection", "1; mode=block")
        c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
        c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        c.Header("Content-Security-Policy",
            "default-src 'self'; "+
            "script-src 'self'; "+
            "style-src 'self' 'unsafe-inline'; "+
            "img-src 'self' https://cdn.nexusainow.online data:; "+
            "connect-src 'self' wss://*.nexusainow.online;")
        c.Next()
    }
}
```

---

## 18. Backup & Disaster Recovery

### Backup Strategy

| Component | Backup Method | Frequency | Retention | RTO | RPO |
|---|---|---|---|---|---|
| **Cloud SQL (PostgreSQL)** | Continuous backup + point-in-time recovery | Continuous | 14 days PITR, 30 days snapshots | 1 hour | 1 minute |
| **Qdrant Cloud** | Scheduled snapshots | Every 6 hours | 7 days | 2 hours | 6 hours |
| **Google Cloud Storage** | Object versioning + multi-region replication | Continuous | 30 days versioning | Near-instant | 0 (multi-region) |
| **BigQuery** | Time-travel queries + dataset snapshots | Continuous | 7 days time-travel | Near-instant | 0 |
| **Upstash Redis** | Automatic persistence (Upstash-managed) | Continuous | Managed by Upstash | ~5 minutes | ~1 minute |
| **Secret Manager** | Version history | Every change | All versions | Near-instant | 0 |

### Disaster Recovery Plan

```mermaid
flowchart TD
    DETECT["Incident Detected\n(Cloud Monitoring alert)"] --> ASSESS{"Severity?"}
    ASSESS -->|P1: Full outage| FAILOVER["Failover to DR region\n1. Promote Cloud SQL read replica\n2. Re-point DNS\n3. Scale up GKE in DR region"]
    ASSESS -->|P2: Partial outage| ISOLATE["Isolate failed service\n1. Circuit breaker activates\n2. Scale healthy pods\n3. Route around failure"]
    ASSESS -->|P3: Data corruption| RESTORE["Restore from backup\n1. Cloud SQL PITR\n2. Qdrant snapshot restore\n3. Verify data integrity"]
    FAILOVER --> VERIFY["Verify DR environment"]
    ISOLATE --> VERIFY
    RESTORE --> VERIFY
    VERIFY --> NOTIFY["Notify stakeholders\nPost-incident review"]
```

### Recovery Time Objectives

| Scenario | RTO Target | RPO Target |
|---|---|---|
| Single service failure | < 5 minutes (HPA auto-heal) | 0 |
| Full region outage | < 1 hour | < 1 minute (Cloud SQL PITR) |
| Database corruption | < 2 hours | < 1 minute |
| Accidental data deletion | < 30 minutes | < 1 minute |

---

## 19. Observability — GCP Operations Suite

All six microservices are natively integrated with GCP's managed observability stack. **No self-hosted Prometheus, Grafana, or Loki to maintain.**

```mermaid
graph TB
    subgraph Services["Microservices"]
        API["nexus-api (Go)"]
        SIO["nexus-socket (Node.js)"]
        RAG["nexus-rag (Python)"]
        AIGW["nexus-ai-gateway (Go)"]
        WRK["nexus-ai-worker (Go)"]
        BILL["nexus-billing (Go)"]
    end

    subgraph GCPOps["GCP Operations Suite"]
        LOG["Cloud Logging\n━━━━━━━━━\n• Structured JSON logs\n• Log-based metrics\n• Log sinks → BigQuery"]
        MON["Cloud Monitoring\n━━━━━━━━━\n• Custom metrics\n• Dashboards\n• Uptime checks\n• Alert policies → PagerDuty / Slack"]
        TRC["Cloud Trace\n━━━━━━━━━\n• Distributed tracing\n• Latency analysis\n• Service dependency graph"]
        ERR["Cloud Error Reporting\n━━━━━━━━━\n• Panic grouping\n• Stack trace analysis\n• Error rate alerts"]
    end

    API & SIO & RAG & AIGW & WRK & BILL --> LOG & MON & TRC & ERR
```

### Key Metrics to Track

| Metric | Source | Alert Threshold |
|---|---|---|
| Request latency (p95) | `nexus-api` | > 500ms |
| Active WebSocket connections | `nexus-socket` | > 10,000 per pod |
| AI inference latency | `nexus-ai-worker` | > 15s |
| Redis Streams pending messages | Cloud Monitoring | > 100 for 5min |
| Cache hit rate | Upstash Redis | < 70% |
| Error rate (5xx) | All services | > 1% for 5min |
| Qdrant search latency | `nexus-rag` | > 100ms |
| LLM token cost per hour | `nexus-ai-gateway` | > $50/hr |
| Billing sync lag | `nexus-billing` | > 60s |
| Tenant quota breaches | `nexus-billing` | any |

### Structured Logging Format (Go)

```go
// internal/logging/logger.go
import "cloud.google.com/go/logging"

type LogEntry struct {
    Severity  string `json:"severity"`
    Message   string `json:"message"`
    Service   string `json:"service"`
    TraceID   string `json:"logging.googleapis.com/trace,omitempty"`
    SpanID    string `json:"logging.googleapis.com/spanId,omitempty"`
    TenantID  string `json:"tenant_id,omitempty"`
    UserID    string `json:"user_id,omitempty"`
    RequestID string `json:"request_id,omitempty"`
    Latency   string `json:"latency,omitempty"`
}
```

---

## 20. CI/CD Pipeline

```mermaid
flowchart LR
    subgraph Dev["Developer"]
        CODE["Push to feature/*"]
    end

    subgraph PR["Pull Request Checks"]
        LINT["golangci-lint (Go)\n+ ESLint (Node.js + React)\n+ ruff (Python)"]
        TEST["go test + jest + pytest\ncoverage > 80%"]
        SCAN["Trivy container scan\ngosec + bandit SAST"]
    end

    subgraph Staging["Merge → develop"]
        BUILD_S["Docker build\n(distroless multi-stage)"]
        PUSH_S["Push to Artifact Registry"]
        DEPLOY_S["Deploy to GKE Autopilot staging"]
        SMOKE["Smoke tests\n+ Playwright E2E"]
    end

    subgraph Prod["Tag → vX.Y.Z"]
        DEPLOY_P["Canary: 10% → 50% → 100%"]
        MONITOR["Watch error rate\n+ p95 latency (10min)"]
        ROLLBACK["Auto-rollback\nif error rate > 1%"]
    end

    CODE --> LINT --> TEST --> SCAN
    SCAN -->|merged| BUILD_S --> PUSH_S --> DEPLOY_S --> SMOKE
    SMOKE -->|tagged| DEPLOY_P --> MONITOR
    MONITOR -->|ok| DONE["✅ Production"]
    MONITOR -->|fail| ROLLBACK
```

### Dockerfile (Multi-Stage Distroless)

```dockerfile
# ── Build stage ──
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /server ./cmd/api

# ── Production stage ──
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /server /server
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/server"]
```

### Dockerfile — nexus-rag (Python)

```dockerfile
# ── Build stage ──
FROM python:3.12-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# ── Production stage ──
FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.12 /usr/local/lib/python3.12
COPY --from=builder /app /app
USER 1000:1000
EXPOSE 50051
CMD ["python", "-m", "app.main"]
```

### Dockerfile — nexus-socket (Node.js)

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app .
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
```

---

## 21. Local Development Environment

Developers can spin up the entire stack locally with a single command using Docker Compose.

```yaml
# docker-compose.yml
version: '3.9'

services:
  # ── Infrastructure ──
  redis:
    image: redis:7-alpine
    ports: ['6379:6379']

  postgres:
    image: postgres:16-alpine
    ports: ['5432:5432']
    environment:
      POSTGRES_DB: nexus
      POSTGRES_USER: root
      POSTGRES_PASSWORD: rootpassword

  qdrant:
    image: qdrant/qdrant:latest
    ports: ['6333:6333', '6334:6334']

  # ── Services ──
  nexus-api:
    build: ./services/nexus-api
    ports: ['8080:8080']
    env_file: .env.local
    depends_on: [redis, postgres]

  nexus-socket:
    build: ./services/nexus-socket
    ports: ['3000:3000']
    env_file: .env.local
    depends_on: [redis, postgres]

  nexus-rag:
    build: ./services/nexus-rag
    ports: ['50051:50051']
    env_file: .env.local
    depends_on: [qdrant]

  nexus-ai-gateway:
    build: ./services/nexus-ai-gateway
    ports: ['8081:8081']
    env_file: .env.local

  nexus-ai-worker:
    build: ./services/nexus-ai-worker
    env_file: .env.local
    depends_on: [redis, postgres, nexus-rag, nexus-ai-gateway, nexus-compute]

  nexus-billing:
    build: ./services/nexus-billing
    ports: ['8082:8082']
    env_file: .env.local
    depends_on: [redis, postgres]

  nexus-compute:
    build: ./services/nexus-compute
    ports: ['50052:50052']
    env_file: .env.local

  # ── Frontend ──
  client:
    build: ./client
    ports: ['5173:5173']
    depends_on: [nexus-api, nexus-socket]
```

**Quick start:**
```bash
cp .env.example .env.local
docker compose up -d
# API:     http://localhost:8080
# Socket:  http://localhost:3000
# Client:  http://localhost:5173
# Qdrant:  http://localhost:6333/dashboard
```

---

## 22. Deployment Topology

```mermaid
graph TB
    subgraph GCP["Google Cloud Platform"]
        subgraph Edge["Edge"]
            ARMOR["Cloud Armor (WAF)"]
            GLB["Global Load Balancer"]
            CDN["Cloud CDN"]
        end

        subgraph GKE["GKE Autopilot Cluster"]
            subgraph NSapi["Namespace: nexus-services"]
                D_API["nexus-api (Go)\n(2-10 pods, HPA)"]
                D_SIO["nexus-socket (Node.js)\n(2-10 pods, HPA)"]
                D_BILL["nexus-billing (Go)\n(2-4 pods, HPA)"]
            end
            subgraph NSai["Namespace: nexus-ai"]
                D_RAG["nexus-rag (Python)\n(2-6 pods, HPA)"]
                D_AIGW["nexus-ai-gateway (Go)\n(2-8 pods, HPA)"]
                D_WRK["nexus-ai-worker (Go)\n(2-8 pods, HPA)"]
                D_COMP["nexus-compute (C++)\n(2-6 pods, HPA)"]
            end
        end

        subgraph Managed["GCP Managed Services"]
            PDB["Cloud SQL PostgreSQL\n(Primary + Read Replica)"]
            PS["Upstash Redis\n(Cache + Streams MQ)"]
            GCS["Cloud Storage\n(multi-region bucket)"]
            SM["Secret Manager"]
            LOGS["Cloud Logging / Monitoring\n/ Trace / Error Reporting"]
        end
    end

    subgraph ThirdParty["Third-Party Managed"]
        QDR["Qdrant Cloud\n(production cluster)"]
        FBA["Firebase Auth"]
        LLMs["Gemini · Claude · GPT\nDeepSeek · Gemma"]
    end

    ARMOR --> GLB
    GLB --> CDN
    GLB --> GKE
    GKE --> Managed
    GKE --> ThirdParty
```

---

## 23. Environment Variables & Secrets

All secrets are stored in **Google Secret Manager** and mounted into pods at startup via GKE Autopilot Workload Identity.

| Secret Name | Service(s) | Description |
|---|---|---|
| `POSTGRES_URI` | All | Cloud SQL PostgreSQL connection string |
| `UPSTASH_REDIS_URL` | All | Upstash Redis connection URL |
| `UPSTASH_REDIS_TOKEN` | All | Upstash Redis REST token |
| `QDRANT_URL` | `nexus-rag` | Qdrant Cloud endpoint |
| `QDRANT_API_KEY` | `nexus-rag` | Qdrant auth key |
| `GEMINI_API_KEY` | `nexus-ai-gateway` | Google Gemini key |
| `CLAUDE_API_KEY` | `nexus-ai-gateway` | Anthropic key |
| `OPENAI_API_KEY` | `nexus-ai-gateway` | OpenAI key |
| `DEEPSEEK_API_KEY` | `nexus-ai-gateway` | DeepSeek key |
| `FIREBASE_SA_JSON` | `nexus-api`, `nexus-socket` | Firebase Admin SDK service account |
| `GCS_BUCKET` | `nexus-api` | Cloud Storage bucket name |
| `STRIPE_SECRET_KEY` | `nexus-billing` | Stripe payment processing |
| `SMTP_HOST` | `nexus-ai-worker` | Email notification credentials |
| `SMTP_KEY` | `nexus-ai-worker` | Email API key |

### Non-Secret Config (Environment Variables)

```bash
# Service identity
SERVICE_NAME=nexus-api          # Per service
GCP_PROJECT=nexus-prod
GCP_REGION=us-central1

# Feature flags
AI_ENABLED=true
MAX_CONTEXT_TOKENS=4096
MAX_UPLOAD_SIZE_MB=50

# Redis Streams (Message Queue)
REDIS_STREAM_AI=stream:ai.inference
REDIS_STREAM_EMBED=stream:embed.messages
REDIS_STREAM_NOTIF=stream:notifications
REDIS_STREAM_BILLING=stream:billing.events
REDIS_STREAM_DLQ=stream:deadletter

# Redis
REDIS_MAX_POOL=50

# Cookie
COOKIE_DOMAIN=.nexusainow.online
COOKIE_SECURE=true
```

---

## 24. Cost Estimation

### Monthly Cost Projection (Moderate Scale: ~10K MAU)

| Service | Tier / Spec | Estimated Monthly Cost |
|---|---|---|
| **GKE Autopilot** | ~24 pods average (incl. nexus-compute) | $500 – $750 |
| **Upstash Redis** | Free tier (256 MB) → Pay-as-you-go at scale | $0 – $50 |
| **Cloud Storage** | 100GB, multi-region | $5 – $10 |
| **Cloud CDN** | 500GB egress | $40 – $60 |
| **Cloud Armor** | Standard tier | $5 + $1/rule |
| **Cloud Logging/Monitoring** | 50GB logs ingestion | $25 – $50 |
| **Cloud Trace** | First 2.5M spans free | $0 – $10 |
| **Secret Manager** | <100 secrets, <10K accesses | $1 |
| **BigQuery** | 10GB storage, 1TB queries | $5 – $15 |
| **Cloud SQL (PostgreSQL)** | Standard 2 vCPU, 16GB | $150 – $300 |
| **Qdrant Cloud** | 2 nodes, 4GB RAM each | $100 – $200 |
| **Firebase Auth** | Free tier (50K MAU) | $0 |
| **LLM APIs** | Variable (token-based) | $200 – $2,000 |
| | **Total** | **~$1,100 – $3,500/mo** |

> **Note**: LLM API costs are the most variable. The AI Gateway's model routing and response caching can reduce these by 30-50%. Using Upstash Redis free tier for dev/staging saves ~$150-200/mo vs Memorystore.

---

## 25. Data Migration Runbook

Migrating from the current monolithic Python/FastAPI system to the new microservices architecture requires careful orchestration across auth, data schema, and vector indices.

### Migration Phases

```mermaid
gantt
    title Data Migration Timeline
    dateFormat  YYYY-MM-DD
    axisFormat  %b %d

    section Phase A — Auth Migration
    Export existing users from MongoDB       :m1, 2026-07-01, 2d
    Import users into Firebase Auth (batch)  :m2, 2026-07-03, 1d
    Map firebase_uid back to users in Cloud SQL   :m3, 2026-07-04, 1d
    Verify auth flow end-to-end              :m4, 2026-07-05, 1d

    section Phase B — Schema Migration
    Create default tenant and workspace      :m5, 2026-07-07, 1d
    Backfill tenant_id and workspace_id      :m6, 2026-07-08, 2d
    Create Cloud SQL schema, RLS, and indexes               :m7, 2026-07-10, 1d
    Verify data integrity                    :m8, 2026-07-11, 1d

    section Phase C — Vector Migration
    Deploy Qdrant Cloud cluster              :m9, 2026-07-14, 1d
    Re-embed all messages via BGE-M3         :m10, 2026-07-15, 3d
    Upsert vectors with tenant metadata      :m11, 2026-07-18, 2d
    Validate search quality vs old system    :m12, 2026-07-20, 1d
    Remove Atlas Vector Search indexes       :m13, 2026-07-21, 1d

    section Phase D — Storage Migration
    Copy avatars from local FS to GCS        :m14, 2026-07-22, 1d
    Update avatar_url in Cloud SQL to CDN URLs :m15, 2026-07-23, 1d
```

### Auth Migration Script (Conceptual)

```python
# scripts/migrate/auth_migration.py
import firebase_admin
from firebase_admin import auth
from pymongo import MongoClient

db = MongoClient(MONGO_URI).nexus

for user in db.users.find():
    # Import user into Firebase Auth
    fb_user = auth.create_user(
        email=user["email"],
        display_name=user.get("full_name", user["username"]),
        photo_url=user.get("profile_image"),
    )
    # Map firebase_uid back to MongoDB
    db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"firebase_uid": fb_user.uid}}
    )
```

### Schema Migration Script (Conceptual)

```javascript
// scripts/migrate/backfill_tenant.js
const DEFAULT_TENANT = "tenant_default";
const DEFAULT_WORKSPACE = "ws_default";

// Backfill all existing collections
for (const coll of ["messages", "groups", "chats", "audit_logs"]) {
  db[coll].updateMany(
    { tenant_id: { $exists: false } },
    { $set: { tenant_id: DEFAULT_TENANT, workspace_id: DEFAULT_WORKSPACE } }
  );
}
```

### Rollback Plan

Each migration phase is independently reversible:
- **Auth**: Firebase users can be deleted in batch; Cloud SQL migration can be repeated.
- **Schema**: `tenant_id`/`workspace_id` fields are additive; old queries still work.
- **Vectors**: Qdrant cluster can be destroyed; old vector store indexes are untouched until Phase C final step.
- **Storage**: Original local files are not deleted until CDN URLs are verified.

---

## 26. Implementation Roadmap

### Phased Rollout

```mermaid
gantt
    title Nexus Production Upgrade — Implementation Roadmap
    dateFormat  YYYY-MM-DD
    axisFormat  %b %d

    section Phase 1 — Foundation (Week 1-2)
    Go project scaffolding (4 Go services)  :crit, p1a, 2026-06-23, 3d
    Node.js scaffolding (nexus-socket)      :crit, p1a1, 2026-06-23, 2d
    Python scaffolding (nexus-rag)          :crit, p1a2, 2026-06-23, 2d
    Proto definitions + Buf setup           :crit, p1a3, 2026-06-24, 2d
    Firebase Auth integration               :crit, p1b, 2026-06-25, 3d
    Upstash Redis setup                     :crit, p1c, 2026-06-26, 2d
    GCS file storage migration              :crit, p1d, 2026-06-27, 2d
    Security headers + Cloud Armor          :p1e, 2026-06-29, 2d
    Secret Manager integration              :p1f, 2026-06-29, 1d
    Docker Compose local dev environment    :p1g, 2026-06-30, 1d

    section Phase 2 — Core Services (Week 3-4)
    nexus-api (Go — REST CRUD)              :crit, p2a, 2026-07-07, 5d
    nexus-socket (Node.js — Socket.IO)      :crit, p2b, 2026-07-07, 5d
    Data migration (Auth + Schema)          :crit, p2b2, 2026-07-07, 7d
    Multi-tenant data model                 :p2c, 2026-07-10, 3d
    Redis caching layer                     :p2d, 2026-07-12, 2d

    section Phase 3 — AI Pipeline (Week 5-6)
    nexus-ai-gateway (Go — multi-model)     :crit, p3a, 2026-07-21, 4d
    nexus-rag (Python — BGE + Qdrant)       :crit, p3b, 2026-07-21, 5d
    AI streaming architecture               :crit, p3b2, 2026-07-23, 3d
    nexus-ai-worker (Go — Redis Streams)    :crit, p3c, 2026-07-24, 4d
    Qdrant Cloud + vector migration         :p3d, 2026-07-26, 5d

    section Phase 3.5 — C++ Compute Service (Week 6-7)
    nexus-compute C++ scaffolding (CMake)   :crit, p35a, 2026-07-28, 3d
    gRPC server + proto definitions         :crit, p35b, 2026-07-28, 2d
    Arena allocator + memory pool impl      :crit, p35c, 2026-07-30, 4d
    Mmap file processing pipeline           :p35d, 2026-08-01, 3d
    Zero-copy Flatbuffers integration       :p35e, 2026-08-01, 2d
    In-memory index (B+ tree / hash map)    :p35f, 2026-08-03, 3d
    Integration testing with Go/Python      :p35g, 2026-08-04, 2d

    section Phase 4 — Billing & Production (Week 7-8)
    nexus-billing (Go — metering/invoices)  :crit, p4a0, 2026-08-11, 4d
    GCP Observability (Logging/Trace/Mon)   :p4a, 2026-08-11, 3d
    CI/CD pipeline (Actions + GKE Autopilot):p4b, 2026-08-11, 3d
    Rate limiting + circuit breakers        :p4c, 2026-08-14, 2d
    RBAC enforcement                        :p4d, 2026-08-14, 2d
    GDPR compliance (export/delete)         :p4d2, 2026-08-15, 3d
    Load testing + canary deployment        :p4e, 2026-08-17, 3d
    BigQuery analytics pipeline             :p4f, 2026-08-19, 2d
    Webhook system                          :p4g, 2026-08-20, 2d
```

### Quick Reference — What Replaces What

| Old (Current) | New (Production) |
|---|---|
| Python / FastAPI monolith | 4 Go + 1 Node.js + 1 Python + 1 C++ microservices |
| Custom JWT + localStorage | Firebase Authentication |
| Direct Gemini API calls | nexus-ai-gateway (multi-model) |
| In-process SentenceTransformers | nexus-rag — Python (BGE-M3 + BGE-Reranker) |
| Full AI response after delay | Token-by-token streaming to client |
| MongoDB Atlas (NoSQL) | Cloud SQL (PostgreSQL 16) |\n| MongoDB Atlas Vector Search | Qdrant Cloud |
| Go Socket.IO (unmaintained) | Node.js Socket.IO (official, battle-tested) |
| In-memory Socket.IO adapter | Upstash Redis adapter |
| Local filesystem | Google Cloud Storage + Cloud CDN |
| In-memory rate limiter | Redis sliding window |
| Synchronous AI execution | Redis Streams async workers |
| `print()` logging | Cloud Logging + Cloud Trace |
| No WAF | Cloud Armor |
| `.env` files | Secret Manager |
| No analytics | BigQuery |
| Single AI model | Gemini / Claude / GPT / DeepSeek / Gemma |
| No multi-tenancy | tenant_id + workspace_id everywhere |
| No usage tracking | nexus-billing (tokens, storage, quotas, invoices) |
| Manual node management | GKE Autopilot (fully managed nodes) |
| No data compliance | GDPR-compliant export & deletion |
| No backups strategy | Automated backups with defined RTO/RPO |
| No local dev environment | Docker Compose one-command setup |
| No API contracts | Shared gRPC proto definitions (Buf) |
| No memory-optimized service | nexus-compute (C++) — custom allocators, mmap, zero-copy |
| GCP Memorystore Redis | Upstash Redis (free tier + serverless scaling) |
| Google Cloud Pub/Sub | Redis Streams (unified with cache layer) |

---

## 27. C++ Integration Plan — `nexus-compute`

### Purpose

`nexus-compute` is a **C++20 microservice** designed for workloads requiring **extensive memory management** — where Go's garbage collector pauses and Python's memory overhead are unacceptable. It runs as a gRPC server called by other services for memory-intensive operations.

### Why C++ for Memory Management?

| Concern | Go / Python | C++ |
|---|---|---|
| **Memory allocation** | GC-managed, unpredictable pauses (Go: ~1-10ms) | Manual / RAII, zero pauses |
| **Custom allocators** | Not possible | Arena, pool, slab, buddy allocators |
| **Memory-mapped I/O** | Limited (`mmap` via syscall) | Native `mmap`, `madvise`, `mlock` |
| **Zero-copy buffers** | Requires `unsafe` (Go) or `ctypes` (Python) | Native pointer arithmetic, Flatbuffers |
| **Memory footprint** | Go: ~10-50 MB base; Python: ~50-200 MB | ~2-5 MB base |
| **Cache-line optimization** | No control | `alignas`, `__attribute__((aligned))` |
| **Lock-free structures** | `sync.Map` (limited) | `std::atomic`, CAS operations, custom lock-free queues |

### Architecture

```mermaid
graph TB
    subgraph Callers["Service Callers"]
        API["nexus-api (Go)"]
        WRK["nexus-ai-worker (Go)"]
        RAG["nexus-rag (Python)"]
    end

    subgraph NexusCompute["nexus-compute (C++20)"]
        GRPC["gRPC Server\n(Port 50052)"]
        
        subgraph MemMgmt["Memory Management Layer"]
            ARENA["Arena Allocator\n• Per-request allocation\n• Bulk free on completion\n• Zero fragmentation"]
            POOL["Memory Pool\n• Per-tenant pools\n• Pre-allocated slabs\n• O(1) alloc/free"]
            MMAP["Memory-Mapped I/O\n• Large file processing\n• OS page cache leverage\n• Lazy loading"]
        end
        
        subgraph DataStructures["In-Memory Data Structures"]
            IDX["Lock-Free Hash Map\n• Concurrent reads\n• Per-tenant message index\n• CAS-based updates"]
            BTREE["B+ Tree Index\n• Range queries\n• Sorted message access\n• Cache-friendly layout"]
            RING["Ring Buffers\n• WebSocket stream mgmt\n• Fixed memory footprint\n• Lock-free SPSC"]
        end
        
        subgraph Processing["Processing Pipelines"]
            ZCOPY["Zero-Copy Serialization\n• Flatbuffers encoding\n• No alloc on decode\n• Direct memory access"]
            FPROC["File Processor\n• PDF text extraction\n• Image thumbnailing\n• Controlled memory budget"]
        end
    end

    API -->|gRPC| GRPC
    WRK -->|gRPC| GRPC
    RAG -->|gRPC| GRPC
    
    GRPC --> MemMgmt
    MemMgmt --> DataStructures
    MemMgmt --> Processing
```

### gRPC Proto Definition

```protobuf
// proto/compute/compute.proto
syntax = "proto3";
package nexus.compute;

service ComputeService {
  // Process a large file with controlled memory budget
  rpc ProcessFile (ProcessFileRequest) returns (ProcessFileResponse);
  
  // Batch-process messages with arena allocation (zero-copy)
  rpc BatchProcessMessages (BatchMessageRequest) returns (BatchMessageResponse);
  
  // Query the in-memory tenant index
  rpc QueryIndex (IndexQueryRequest) returns (IndexQueryResponse);
  
  // Stream-process binary payloads (e.g., thumbnails)
  rpc StreamProcess (stream BinaryChunk) returns (ProcessedResult);
}

message ProcessFileRequest {
  string tenant_id = 1;
  string file_url = 2;           // GCS signed URL
  string operation = 3;          // "extract_text", "thumbnail", "analyze"
  int64 memory_budget_bytes = 4; // Max memory to use (e.g., 256MB)
}

message ProcessFileResponse {
  bytes result = 1;
  int64 peak_memory_bytes = 2;
  double processing_time_ms = 3;
}

message BatchMessageRequest {
  string tenant_id = 1;
  repeated MessagePayload messages = 2;
  string operation = 3;          // "index", "serialize", "transform"
}

message MessagePayload {
  string id = 1;
  string content = 2;
  int64 timestamp = 3;
  map<string, string> metadata = 4;
}

message BatchMessageResponse {
  int32 processed_count = 1;
  int64 peak_memory_bytes = 2;
  double processing_time_ms = 3;
}

message IndexQueryRequest {
  string tenant_id = 1;
  string query = 2;
  int64 time_range_start = 3;
  int64 time_range_end = 4;
  int32 limit = 5;
}

message IndexQueryResponse {
  repeated MessagePayload results = 1;
  int32 total_matches = 2;
  double query_time_ms = 3;
}

message BinaryChunk {
  bytes data = 1;
  bool is_final = 2;
}

message ProcessedResult {
  bytes output = 1;
  string content_type = 2;
  int64 peak_memory_bytes = 3;
}
```

### Project Structure

```text
services/nexus-compute/
├── CMakeLists.txt              (Build system)
├── vcpkg.json                  (Dependency manifest)
├── Dockerfile                  (Multi-stage build)
├── include/
│   ├── allocators/
│   │   ├── arena_allocator.h   (Per-request arena)
│   │   ├── pool_allocator.h    (Per-tenant memory pool)
│   │   └── slab_allocator.h    (Fixed-size block allocator)
│   ├── containers/
│   │   ├── lockfree_hashmap.h  (CAS-based concurrent map)
│   │   ├── bplus_tree.h        (Cache-friendly B+ tree)
│   │   └── ring_buffer.h       (SPSC lock-free ring buffer)
│   ├── processing/
│   │   ├── file_processor.h    (Mmap-based file processing)
│   │   └── flatbuf_codec.h     (Zero-copy serialization)
│   └── server/
│       └── compute_server.h    (gRPC service implementation)
└── src/
    ├── main.cpp                (Entry point, gRPC server startup)
    ├── allocators/
    │   ├── arena_allocator.cpp
    │   ├── pool_allocator.cpp
    │   └── slab_allocator.cpp
    ├── containers/
    │   ├── lockfree_hashmap.cpp
    │   └── bplus_tree.cpp
    ├── processing/
    │   ├── file_processor.cpp
    │   └── flatbuf_codec.cpp
    └── server/
        └── compute_server.cpp
```

### Key Memory Patterns

#### Arena Allocator (Per-Request)
```cpp
// include/allocators/arena_allocator.h
class ArenaAllocator {
public:
    explicit ArenaAllocator(size_t block_size = 1024 * 1024) // 1MB blocks
        : block_size_(block_size) {
        allocate_block();
    }
    
    // O(1) allocation — just bump a pointer
    void* allocate(size_t size, size_t alignment = alignof(std::max_align_t)) {
        size_t padding = align_up(current_offset_, alignment) - current_offset_;
        if (current_offset_ + padding + size > block_size_) {
            allocate_block();  // Get a new block
            padding = 0;
        }
        void* ptr = current_block_ + current_offset_ + padding;
        current_offset_ += padding + size;
        return ptr;
    }
    
    // No individual free — entire arena is freed at once (on request completion)
    ~ArenaAllocator() {
        for (auto* block : blocks_) {
            ::operator delete(block);
        }
    }
    
    size_t bytes_allocated() const { return total_allocated_; }

private:
    void allocate_block() {
        auto* block = static_cast<char*>(::operator new(block_size_));
        blocks_.push_back(block);
        current_block_ = block;
        current_offset_ = 0;
        total_allocated_ += block_size_;
    }
    
    static size_t align_up(size_t offset, size_t alignment) {
        return (offset + alignment - 1) & ~(alignment - 1);
    }
    
    size_t block_size_;
    std::vector<char*> blocks_;
    char* current_block_ = nullptr;
    size_t current_offset_ = 0;
    size_t total_allocated_ = 0;
};
```

#### Memory-Mapped File Processing
```cpp
// include/processing/file_processor.h
class MmapFileProcessor {
public:
    ProcessResult process(const std::string& file_path, int64_t memory_budget) {
        int fd = open(file_path.c_str(), O_RDONLY);
        struct stat st;
        fstat(fd, &st);
        
        // Memory-map the file — OS handles paging, no heap allocation
        void* mapped = mmap(nullptr, st.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
        madvise(mapped, st.st_size, MADV_SEQUENTIAL);  // Hint: sequential access
        
        // Process in chunks within memory budget
        ArenaAllocator arena(memory_budget);
        auto result = extract_content(
            static_cast<const char*>(mapped), st.st_size, arena
        );
        
        munmap(mapped, st.st_size);
        close(fd);
        return result;
    }
};
```

### Dockerfile (Multi-Stage Build)

```dockerfile
# ── Build stage ──
FROM ubuntu:24.04 AS builder
RUN apt-get update && apt-get install -y \
    build-essential cmake git pkg-config \
    libgrpc++-dev protobuf-compiler-grpc \
    libjemalloc-dev libflatbuffers-dev
WORKDIR /app
COPY vcpkg.json CMakeLists.txt ./
COPY include/ include/
COPY src/ src/
COPY proto/ proto/
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_FLAGS="-O3 -march=native -flto" && \
    cmake --build build --parallel $(nproc)

# ── Production stage ──
FROM ubuntu:24.04-minimal
RUN apt-get update && apt-get install -y --no-install-recommends \
    libjemalloc2 libgrpc++1 && \
    rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/build/nexus-compute /nexus-compute
# Use jemalloc for all allocations
ENV LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libjemalloc.so.2
USER 1000:1000
EXPOSE 50052
ENTRYPOINT ["/nexus-compute"]
```

### Integration Points

| Caller | RPC | Use Case |
|---|---|---|
| `nexus-api` | `ProcessFile` | Thumbnail generation for uploaded images; PDF text extraction for document search |
| `nexus-api` | `BatchProcessMessages` | Bulk message export with zero-copy serialization (GDPR data export) |
| `nexus-ai-worker` | `BatchProcessMessages` | Index new messages into per-tenant in-memory B+ tree for fast retrieval |
| `nexus-ai-worker` | `QueryIndex` | Sub-millisecond message lookup by time range before sending to RAG pipeline |
| `nexus-rag` | `StreamProcess` | Process large document chunks with controlled memory budget before embedding |

### Fallback Strategy

If `nexus-compute` is unavailable (crash, deployment, scaling), callers fall back to native implementations:

```go
// internal/compute/client.go (in nexus-api or nexus-ai-worker)
func (c *ComputeClient) ProcessFileWithFallback(ctx context.Context, req *pb.ProcessFileRequest) (*pb.ProcessFileResponse, error) {
    // Try C++ service first
    resp, err := c.grpcClient.ProcessFile(ctx, req)
    if err == nil {
        return resp, nil
    }
    
    // Circuit breaker tripped or service unavailable — fallback to Go
    log.Warn("nexus-compute unavailable, using Go fallback", "error", err)
    return c.goFallback.ProcessFile(ctx, req)  // Slower but functional
}
```

**Fallback tradeoffs**: Go/Python fallbacks work but with:
- ~10-50x higher memory usage (GC overhead, no custom allocators)
- GC pauses (1-10ms in Go, stop-the-world in Python)
- No memory-mapped I/O (full file loads into heap)
- No lock-free data structures (mutex-based instead)

### Resource Budget

| Metric | Target |
|---|---|
| Base memory | ~5 MB (no GC, no runtime) |
| Per-request arena | 1-64 MB (configurable, freed on completion) |
| Per-tenant index | ~100 MB (B+ tree + hash map) |
| File processing | Bounded by `memory_budget_bytes` in request |
| Peak memory per pod | 1-4 GB (controlled, no leaks via RAII) |
| Cold start | < 500ms (compiled binary, no interpreter) |

---

*Generated: 2026-08-01 | Stack: Go · Node.js · Python · C++ · GKE Autopilot · Firebase · Redis Streams · Upstash Redis · Cloud SQL PostgreSQL · Qdrant Cloud · Cloud Storage · Cloud Armor · Secret Manager · BigQuery*
