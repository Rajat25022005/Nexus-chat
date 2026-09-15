# Nexus Chat Documentation

Welcome to the technical documentation directory for **Nexus Chat**. This repository contains production architecture blueprints, technical inventories, comparative technology studies, audit reports, and subsystem plans.

---

## Directory Overview

### 🏛️ [`architecture/`](./architecture/)
- **[`ARCHITECTURE.md`](./architecture/ARCHITECTURE.md)**: Production SaaS architectural blueprint covering multi-tenant data modeling, GCP deployment topology, AI Gateway multi-model routing, and Redis Streams message queues.
- **[`CURRENT_STATE.md`](./architecture/CURRENT_STATE.md)**: Microservices system state and technical inventory covering Go Gin REST APIs, Node.js/Elixir Socket services, Python RAG pipelines, and vector retrieval.
- **[`NEXUS_NEXT_GEN_ARCHITECTURE.md`](./architecture/NEXUS_NEXT_GEN_ARCHITECTURE.md)**: Comparative benchmark study across Elixir/OTP, Erlang, Rust, and Go for 1M+ concurrent connections, Delta-CRDT presence tracking, and zero-downtime migration.
- **[`new.md`](./architecture/new.md)**: Initial microservices architecture draft specification.

### 📋 [`plans/`](./plans/)
- **[`NEXUS_API_STORAGE_AND_DISCOVERY_PLAN.md`](./plans/NEXUS_API_STORAGE_AND_DISCOVERY_PLAN.md)**: Exhaustive implementation specification for contact discovery, direct 1-on-1 chats, and MinIO S3 object storage with pre-signed URLs.
- **[`ORIGINAL_REQUEST.md`](./plans/ORIGINAL_REQUEST.md)**: Chronological project requirements, prompt specifications, and acceptance criteria from inception to repository reorganization.

### 🛡️ [`audits/`](./audits/)
- **[`NEXUS_API_AUDIT_REPORT.md`](./audits/NEXUS_API_AUDIT_REPORT.md)**: Master security, concurrency, data integrity, and cloud infrastructure audit report for `nexus-api`.

---

## Subsystem Documentation
For service-specific guides and audits, refer to:
- Frontend Client Audit: [`client/FRONTEND_SECURITY_AUDIT.md`](../client/FRONTEND_SECURITY_AUDIT.md)
- Socket Service Audit: [`services/nexus-socket/SECURITY_AND_QUALITY_AUDIT.md`](../services/nexus-socket/SECURITY_AND_QUALITY_AUDIT.md)
- Postman API & Socket Guide: [`postman/POSTMAN_GUIDE.md`](../postman/POSTMAN_GUIDE.md)
