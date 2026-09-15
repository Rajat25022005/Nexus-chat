# Nexus Chat — Testing & Benchmarking Suite

This directory contains end-to-end integration tests, high-concurrency load tests, and extreme benchmark harnesses for Nexus Chat.

---

## Directory Overview

```text
tests/
├── README.md                      # This guide
├── e2e/                           # End-to-End Integration Tests
│   ├── test_api_e2e.py            # Automated REST API verification (Auth, Workspaces, Groups, Chats)
│   └── test_socket_e2e.mjs        # Automated Socket.IO v4 real-time flow verification
└── load/                          # Concurrency, Throughput & Stress Tests
    ├── api_load_test.js           # Standard API load test (invoked via `make test-load-api`)
    ├── socket_load_test.js        # Standard Socket load test (invoked via `make test-load-socket`)
    ├── api_10k_test.js            # 10,000 requests stress test (invoked via `make test-10k`)
    ├── run_high_stress_benchmarks.js # Tiered stress benchmarks (500 to 5,000 workers)
    ├── benchmarks/                # Advanced stress and capacity benchmark scripts
    │   ├── extreme_socket_stress_test.mjs  # C10K socket stress test
    │   ├── ramp_stress_test.mjs            # Stepped worker ramp test
    │   ├── runtime_metrics_load_test.mjs   # VM telemetry profiling
    │   └── ...
    └── reports/                   # Output directory for benchmark scorecards and JSON reports
```

---

## 1. Running Service Unit Tests

Run all unit tests across Go and Elixir services directly via the root `Makefile`:

```bash
# Run Go unit tests across all services (nexus-api, gateway, worker, billing)
make test

# Run Elixir ExUnit tests (nexus-socket)
make test-socket

# Run all unit tests
make test-all
```

---

## 2. End-to-End (E2E) Integration Tests

Before running E2E tests, ensure services are running (`docker compose up -d postgres redis` and start `nexus-api` and `nexus-socket`).

### API E2E Verification
Runs with Python standard library (no pip packages required):
```bash
python tests/e2e/test_api_e2e.py

# Or with pytest
pytest tests/e2e/test_api_e2e.py
```

### Real-Time Socket E2E Verification
Runs with Node.js 20+ native WebSocket:
```bash
node tests/e2e/test_socket_e2e.mjs
```

---

## 3. Load & Stress Tests

Run standardized load test targets via `make`:

### API Concurrency Load Test
```bash
# Default: 100 workers, 15 seconds, 3s ramp-up
make test-load-api

# Custom parameters:
USERS=500 DURATION=30 RAMP=5 make test-load-api
```

### WebSocket Real-Time Load Test
```bash
# Default: 100 concurrent WebSockets, 15 seconds, 3s ramp-up
make test-load-socket

# Custom parameters:
USERS=1000 DURATION=30 RAMP=5 make test-load-socket
```

### 10,000 Requests Stress Test
```bash
# Default: 10,000 requests with 300 concurrent in-flight workers
make test-10k

# Custom parameters:
REQUESTS=20000 CONCURRENCY=500 node tests/load/api_10k_test.js
```

### Multi-Tier High-Stress Suite (500 to 5,000 Workers)
```bash
node tests/load/run_high_stress_benchmarks.js
```
Outputs detailed latency percentiles (p50, p90, p95, p99), error rates, and throughput metrics.
