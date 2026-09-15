# Nexus Workplace AI

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)]()
[![Architecture](https://img.shields.io/badge/architecture-polyglot_microservices-blue.svg)]()
[![Go](https://img.shields.io/badge/Go-1.22+-00ADD8?logo=go&logoColor=white)]()
[![Elixir](https://img.shields.io/badge/Elixir-1.14+-4B275F?logo=elixir&logoColor=white)]()
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)]()
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)]()
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)]()
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)]()
[![Qdrant](https://img.shields.io/badge/Qdrant-Vector_DB-E63946?logo=qdrant&logoColor=white)]()
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Nexus Workplace AI is an enterprise-grade agentic collaboration platform that integrates high-concurrency real-time communication with context-aware artificial intelligence.

Unlike traditional chat tools with bolt-on chatbots, Nexus operates as an active workspace collaborator. It retains long-term organizational memory, synthesizes multi-turn conversational history with semantic knowledge retrieval (Hybrid RAG), and streams sub-second inferences from multi-model LLMs directly into collaborative team channels.

---

## System Architecture

Nexus is built as a polyglot, distributed microservices system designed for horizontal scaling, strict multi-tenant isolation, and high availability on Google Cloud Platform (GCP).

```mermaid
graph TB
    subgraph ClientLayer["Frontend Client"]
        WEB["React 19 + TypeScript + Vite\n(Tailwind CSS · GSAP · Prism)"]
    end

    subgraph IngressLayer["Edge & Ingress Routing"]
        GLB["Google Cloud Load Balancer\n(Cloud Armor WAF · TLS Termination)"]
        WEB -->|HTTPS REST| GLB
        WEB -->|WSS Socket.IO| GLB
    end

    subgraph ServiceMesh["Microservices Layer"]
        API["nexus-api :8080\n(Go / Gin / sqlc)"]
        SOCK["nexus-socket :3001\n(Elixir / Phoenix / Bandit)"]
        WORKER["nexus-ai-worker\n(Go Agent Orchestrator)"]
        RAG["nexus-rag :50051\n(Python / gRPC / BGE-M3)"]
        GATEWAY["nexus-ai-gateway :8081\n(Go / gRPC Multi-Model Router)"]
        BILLING["nexus-billing :8082\n(Go / gRPC Usage Metering)"]
    end

    subgraph DataLayer["Persistence & Memory Layer"]
        PG[("PostgreSQL 16 / AlloyDB\n(Multi-Tenant Relational Data)")]
        REDIS[("Redis 7 / Memorystore\n(Adapter · AI Stream PubSub · Cache)")]
        QDRANT[("Qdrant Vector DB\n(Dense + Sparse Hybrid Vectors)")]
        PUBSUB[("GCP Cloud Pub/Sub\nai.inference & embed.messages")]
        BQ[("Google BigQuery\n(Token Usage Analytics)")]
    end

    subgraph LLMProviders["External AI Providers"]
        GROQ["Groq (Llama-3.3-70B)"]
        GEMINI["Google Gemini (2.0 Flash / 1.5 Pro)"]
        ANTHROPIC["Anthropic (Claude 3.5 Sonnet)"]
        OPENAI["OpenAI (GPT-4o)"]
        DEEPSEEK["DeepSeek (Chat / Coder)"]
    end

    GLB -->|/api/*| API
    GLB -->|/socket.io/*| SOCK

    API -->|pgxpool 80 conns| PG
    SOCK -->|pg pool 50 conns| PG
    SOCK -->|Socket Adapter| REDIS
    SOCK -->|Publish Jobs| PUBSUB

    PUBSUB -->|Consume Jobs| WORKER
    WORKER -->|1. Fetch Recent History| PG
    WORKER -->|2. gRPC RetrieveContext| RAG
    RAG -->|Hybrid Vector Search| QDRANT
    WORKER -->|3. gRPC StreamResponse| GATEWAY
    GATEWAY --> GROQ & GEMINI & ANTHROPIC & OPENAI & DEEPSEEK
    WORKER -->|4. Publish AI Stream Delta| REDIS
    REDIS -->|Relay Stream to Room| SOCK
    SOCK -->|Emit ai_stream_chunk| WEB
    WORKER -->|5. Persist AI Message| PG
    WORKER -->|6. gRPC ReportUsage| BILLING
    BILLING -->|Streaming Insert| BQ
```

---

## Key Features

### Real-Time Team Collaboration
- **Low-Latency WebSockets** — Real-time bi-directional messaging with horizontal multi-pod synchronization via `@socket.io/redis-adapter`.
- **Database-Enforced Authorization** — Channel and DM access verification against PostgreSQL before joining WebSocket rooms.
- **Atomic Single-Trip Ingestion** — Membership authorization and message persistence executed in a single atomic PostgreSQL CTE.
- **Message Threads** — Dedicated side-panel and mobile drawer conversation threads with atomic counter caches (`thread_count`, `thread_last_reply_at`).
- **Emoji Reactions** — Concurrency-safe atomic toggle CTE on `message_reactions` table with real-time room broadcasts.
- **In-Place Message Editing and Soft Deletion** — Edit tracking (`is_edited`) and non-destructive deletion placeholders (`is_deleted`).
- **Enterprise Group Identifier System** — Crockford Base32 invite code generation (`NX7K-Q2R9`) for frictionless group invitations.

### Context-Aware Hybrid RAG and AI Assistance
- **Dual-Representation Embeddings** — `BAAI/bge-m3` embedding model generating 1024-dimensional dense vectors and lexical sparse weights.
- **Qdrant Hybrid Search** — Combined dense semantic retrieval and sparse keyword matching scored with Reciprocal Rank Fusion (RRF).
- **Cross-Encoder Reranking** — `BAAI/bge-reranker-large` cross-encoder for deep contextual relevance filtering and score thresholding.
- **Conversational Context Synthesis** — Multi-turn history (last 25 messages from PostgreSQL) blended with top-ranked RAG context chunks.
- **Sub-Second Streaming Inference** — Prioritized inference via Groq Llama-3.3-70B with token-by-token streaming and cursor animation.

### Resilient Multi-Model AI Gateway
- **Multi-Provider LLM Router** — Seamless routing between Groq, Google Gemini, Anthropic Claude, OpenAI, and DeepSeek.
- **Circuit Breakers and Fallback Chains** — Sony `gobreaker` circuit breakers per provider with automatic fallback across models (`fast`, `quality`, `code`, `summarize`, `enterprise`).
- **SHA-256 Response Caching** — Key-hashed semantic response caching to eliminate duplicate API calls and lower inference costs.

### Enterprise Architecture and Security
- **Multi-Tenant Hierarchy** — Strict tenant isolation across Tenants, Workspaces, Groups, and Chats.
- **Role-Based Access Control (RBAC)** — Owner, admin, and member roles enforced across API and WebSocket handlers.
- **Immutable Audit Logging** — Full event tracking (`group_audit_log`) for administrative visibility.
- **Token Usage Metering** — Asynchronous token telemetry streaming into Google BigQuery for analytics and quota enforcement.

---

## Microservices

| Service | Technology Stack | Port / Protocol | Core Responsibilities |
|---|---|---|---|
| [`nexus-api`](services/nexus-api) | Go 1.25, Gin, `pgx/v5`, `sqlc`, MinIO S3 | `:8080` (HTTP REST) | User auth (JWT), user discovery, direct 1:1 chats, MinIO pre-signed URLs, tenant & workspace management, RBAC. |
| [`nexus-socket`](services/nexus-socket) | Elixir 1.14+, Phoenix OTP, Bandit | `:3001` (WebSocket / HTTP) | Real-time Socket.IO v4 gateway, Delta-CRDT presence (`Phoenix.Tracker`), soft real-time AI token streaming. |
| [`nexus-rag`](services/nexus-rag) | Python 3.12, FastAPI, gRPC, PyTorch | `:50051` (gRPC) / `:8000` (HTTP) | BGE-M3 dense/sparse embeddings, Qdrant hybrid vector search, BGE-Reranker cross-encoder scoring, token estimation. |
| [`nexus-ai-gateway`](services/nexus-ai-gateway) | Go 1.22+, gRPC, Sony `gobreaker` | `:8081` (gRPC) | Multi-provider LLM routing (Groq, Gemini, Claude, OpenAI, DeepSeek), circuit breakers, response caching, streaming. |
| [`nexus-ai-worker`](services/nexus-ai-worker) | Go 1.22+, GCP Cloud Pub/Sub, gRPC | Background Worker | Asynchronous queue consumer (`ai.inference`, `embed.messages`), context synthesis, stream publishing, DB persistence. |
| [`nexus-billing`](services/nexus-billing) | Go 1.22+, gRPC, Google BigQuery | `:8082` (gRPC) | Token usage telemetry ingestion, tenant quota management, streaming inserts to Google BigQuery. |
| [`client`](client) | React 19, TypeScript, Vite, Tailwind | `:5173` (HTTP) | Real-time chat UI, markdown code syntax highlighting, thread panels, emoji pickers, command palette, themes. |

---

## Tech Stack

| Category | Technologies |
|---|---|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS, GSAP, Lucide Icons, Prism, React Markdown (GFM) |
| **Backend APIs and Workers** | Go 1.22+ (Gin, `pgx/v5`, `sqlc`, gRPC), Node.js (Socket.IO, Redis Client), Python 3.12 (PyTorch, FastAPI, gRPC) |
| **Databases and Caching** | PostgreSQL 16 (AlloyDB / Cloud SQL), Redis 7 (Memorystore), Qdrant Vector Database |
| **Event Mesh** | Google Cloud Pub/Sub (`ai.inference`, `embed.messages`), Redis Pub/Sub (`room:*:ai_stream`) |
| **AI and Embedding Models** | FlagEmbedding `BAAI/bge-m3`, `BAAI/bge-reranker-large`, Groq Llama-3.3-70B, Gemini 2.0 Flash / 1.5 Pro, Claude 3.5 Sonnet, GPT-4o |
| **Analytics and Observability** | Google BigQuery, GCP Cloud Logging and Monitoring, OpenTelemetry |
| **Infrastructure and DevOps** | Docker, Docker Compose, Kubernetes (GKE with HPA/PDB/BackendConfig), Terraform |

---

## Getting Started

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/)
- [Node.js 20+](https://nodejs.org/) (for local client development)
- [Go 1.22+](https://golang.org/) (optional, for standalone service debugging)
- [Python 3.10+](https://www.python.org/) (optional, for standalone RAG debugging)
- LLM API Keys (e.g. `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`)

---

### 1. Clone the Repository
```bash
git clone https://github.com/Rajat25022005/Nexus-Workplace-AI.git
cd Nexus-Workplace-AI
```

### 2. Configure Environment Variables
Copy the example environment file to `.env.local`:
```bash
cp .env.example .env.local
```

Edit `.env.local` with your configuration and API keys:
```env
# Database and Redis
DATABASE_URL=postgres://root:rootpassword@localhost:5432/nexus?sslmode=disable
REDIS_URL=redis://localhost:6379

# JWT Auth
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# Vector DB
QDRANT_HOST=localhost
QDRANT_PORT=6333

# AI Provider API Keys
GROQ_API_KEY=your_groq_api_key
GEMINI_API_KEY=your_gemini_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
OPENAI_API_KEY=your_openai_api_key
DEEPSEEK_API_KEY=your_deepseek_api_key

# Google Cloud Project (for Pub/Sub emulator in local dev)
GCP_PROJECT_ID=nexus-local
PUBSUB_EMULATOR_HOST=localhost:8085
```

---

### 3. Run the Full Stack via Docker Compose
Start the complete infrastructure and all microservices:
```bash
docker compose up --build
```

This provisions the following services:

| Container | Port(s) | Description |
|---|---|---|
| `postgres` | 5432 | PostgreSQL 16 with auto-migration scripts |
| `redis` | 6379 | Redis 7 cache and Pub/Sub adapter |
| `qdrant` | 6333, 6334 | Qdrant vector database |
| `pubsub-emulator` | 8085 | GCP Pub/Sub emulator with auto-provisioned topics |
| `nexus-api` | 8080 | Go REST API |
| `nexus-socket` | 3001 | Elixir / Phoenix OTP Socket.IO gateway |
| `nexus-rag` | 50051, 8000 | Python gRPC and HTTP RAG service |
| `nexus-ai-gateway` | 8081 | Go gRPC LLM gateway |
| `nexus-ai-worker` | — | Background Pub/Sub subscriber |
| `nexus-billing` | 8082 | Go gRPC billing service |

---

### 4. Start the Frontend Development Server
In a separate terminal:
```bash
cd client
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Performance Benchmarks

Load testing benchmarks executed with 300 concurrent workers (`tests/load/benchmark_300_workers.json`):

| Metric | Value |
|---|---|
| Concurrent Workers | 300 |
| Total Requests | 20,000 |
| Success Rate | 99.99% (19,999 / 20,000) |
| Sustained Throughput | 774.59 RPS |
| Median Latency (p50) | 312.79 ms |
| 95th Percentile Latency (p95) | 491.89 ms |

---

## Repository Structure

```
.
├── client/                     # React 19 + TypeScript + Vite frontend
│   ├── src/
│   │   ├── chat/               # Chat UI, MessageBubble, ThreadPanel, Sidebar
│   │   ├── components/         # Modals, CommandPalette, ErrorBoundary
│   │   ├── context/            # WorkspaceContext and real-time state
│   │   ├── hooks/              # useSocket, useMessages, useGroups
│   │   └── stores/             # Zustand authStore and themeStore
│   └── Dockerfile
├── services/
│   ├── nexus-api/              # Go REST API (Auth, Workspaces, Groups, Chats)
│   ├── nexus-socket/           # Elixir / Phoenix OTP Socket.IO real-time microservice
│   ├── nexus-rag/              # Python FastAPI + gRPC BGE-M3 / Qdrant RAG
│   ├── nexus-ai-gateway/       # Go gRPC Multi-Model LLM Gateway
│   ├── nexus-ai-worker/        # Go Pub/Sub Consumer and Agent Orchestrator
│   └── nexus-billing/          # Go gRPC BigQuery usage metering service
├── proto/                      # Protocol Buffers definitions (rag, gateway, billing)
├── infra/                      # Terraform GCP infrastructure modules and GKE manifests
├── scripts/                    # Database migrations, embedding backfill and seed scripts
├── tests/                      # Concurrency benchmarks and load testing scripts
├── docs/                       # Consolidated architecture, audit, and planning documentation
│   ├── architecture/           # Architecture blueprints, current state, and next-gen specs
│   ├── plans/                  # Storage & discovery plans, requirements history
│   └── audits/                 # Security and code quality audit reports
├── docker-compose.yml          # Local development orchestration
└── Makefile                    # Build and development commands
```

---

## Documentation

Consolidated technical specifications and architectural documentation are available in the [`docs/`](docs/) directory:
- **[System Architecture Blueprint](docs/architecture/ARCHITECTURE.md)**: Production SaaS architecture and GCP topology.
- **[Current State & Technical Inventory](docs/architecture/CURRENT_STATE.md)**: Polyglot microservices system breakdown.
- **[Next-Generation Architecture Specification](docs/architecture/NEXUS_NEXT_GEN_ARCHITECTURE.md)**: High-concurrency distributed Elixir/OTP architecture.
- **[User Discovery & Object Storage Plan](docs/plans/NEXUS_API_STORAGE_AND_DISCOVERY_PLAN.md)**: MinIO S3 storage, pre-signed URLs, and contact discovery.
- **[Security & Reliability Audit Report](docs/audits/NEXUS_API_AUDIT_REPORT.md)**: Full-depth audit findings and mitigations for `nexus-api`.

---

## Roadmap

- [x] Polyglot microservices migration (Go, Node.js, Python)
- [x] Multi-tenant relational data model with PostgreSQL
- [x] Hybrid vector search with BGE-M3 and Qdrant
- [x] Multi-provider AI gateway with circuit breakers
- [x] Message threads, emoji reactions, and in-place message editing
- [x] Group invite codes and command palette
- [x] Token usage metering with Google BigQuery
- [ ] Direct file attachments and multi-modal OCR parsing
- [ ] Ephemeral user presence indicators (Online / Idle / Offline)
- [ ] Voice interface and audio transcription via Whisper
- [ ] Slack and Discord bi-directional integration bridges

---

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.
