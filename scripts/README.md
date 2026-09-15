# Nexus Chat — Scripts & Automation

This directory contains operational, database migration, initialization, and development utility scripts for Nexus Chat.

---

## Directory Structure

```text
scripts/
├── migrate/                        # PostgreSQL schema initialization
│   └── 001_initial_schema.sql      # Auto-executed by docker-compose postgres container
├── seed/                           # Event mesh and emulator initialization
│   ├── .gitkeep
│   └── pubsub_emulator_init.sh     # Pub/Sub topic and subscription bootstrapper
└── dev/                            # Local development helper scripts
    └── seed_demo_data.sh           # Seeds admin user and demo workspace via API
```

---

## 1. Database Migrations (`scripts/migrate/`)
- **`001_initial_schema.sql`**: Mounted into `/docker-entrypoint-initdb.d` inside the PostgreSQL 16 container (`docker-compose.yml`). Automatically provisions all relational tables, indexes, and constraints on container first run.

## 2. Event Mesh Initialization (`scripts/seed/`)
- **`pubsub_emulator_init.sh`**: Initializes Google Cloud Pub/Sub topics (`ai.inference`, `embed.messages`) and subscriptions within the local emulator container.

## 3. Developer Utilities (`scripts/dev/`)
- **`seed_demo_data.sh`**: Registers an initial admin user and bootstraps default tenant/workspace data:
  ```bash
  ./scripts/dev/seed_demo_data.sh
  ```

> Note: All load testing and benchmark execution scripts have been consolidated into [`tests/load/`](../tests/load/).
