.PHONY: all build build-all build-socket build-prod up prod-up down test test-socket test-all test-load-api test-load-socket test-10k clean logs

# Default target
all: build-all

# Build target alias
build: build-all

# Build all Go binaries and Elixir socket service
build-all: build-socket
	@echo "Building all Go services..."
	cd services/nexus-api && go build -buildvcs=false -o bin/api ./cmd/server
	cd services/nexus-ai-gateway && go build -buildvcs=false -o bin/gateway ./cmd/gateway
	cd services/nexus-ai-worker && go build -buildvcs=false -o bin/worker ./cmd/worker
	cd services/nexus-billing && go build -buildvcs=false -o bin/billing ./cmd/billing
	@echo "Build complete."

# Build Elixir socket service
build-socket:
	@echo "Compiling Elixir socket service..."
	cd services/nexus-socket && mix deps.get && mix compile

# Build production docker images locally
build-prod:
	@echo "Building production Docker images..."
	docker compose -f docker-compose.prod.yml build

# Run docker-compose up for development
up:
	docker compose up -d

# Run production docker-compose
prod-up:
	docker compose -f docker-compose.prod.yml up -d

# Run docker-compose down
down:
	docker compose down
	docker compose -f docker-compose.prod.yml down

# Run tests
test:
	@echo "Running Go tests..."
	cd services/nexus-api && go test -buildvcs=false ./...
	cd services/nexus-ai-gateway && go test -buildvcs=false ./...
	cd services/nexus-ai-worker && go test -buildvcs=false ./...
	cd services/nexus-billing && go test -buildvcs=false ./...
	@echo "Tests complete."

test-socket:
	@echo "Running Elixir ExUnit tests..."
	cd services/nexus-socket && mix test

test-all: test test-socket
	@echo "All service tests passed."

# Run Load Tests (Usage: make test-load-api USERS=500 DURATION=20)
test-load-api:
	USERS=$(or $(USERS),100) DURATION=$(or $(DURATION),15) RAMP=$(or $(RAMP),3) node tests/load/api_load_test.js

test-load-socket:
	USERS=$(or $(USERS),100) DURATION=$(or $(DURATION),15) RAMP=$(or $(RAMP),3) node tests/load/socket_load_test.js

# Run 10,000 Requests Stress Test
test-10k:
	REQUESTS=10000 CONCURRENCY=300 node tests/load/api_10k_test.js


# Clean binaries and build artifacts
clean:
	rm -rf services/nexus-*/bin
	rm -rf services/nexus-api/bin
	rm -rf services/nexus-socket/_build services/nexus-socket/erl_crash.dump
	rm -f coverage.out services/*/coverage.out *.out

# Show logs
logs:
	docker compose logs -f

