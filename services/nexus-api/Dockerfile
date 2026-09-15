# ==============================================================================
# Multi-Stage Production Dockerfile for Nexus API (Go 1.25)
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Builder
# ------------------------------------------------------------------------------
FROM golang:alpine AS builder

WORKDIR /src

# Cache module dependencies
COPY go.mod go.sum ./
RUN go mod download || (sleep 2 && go mod download)

# Copy application source code
COPY . .

# Compile static, stripped Linux binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /nexus-api ./cmd/server

# ------------------------------------------------------------------------------
# Stage 2: Final Minimal Runtime Image
# ------------------------------------------------------------------------------
FROM alpine:3.21

# Install CA certificates for TLS and tzdata for timezone resolution
RUN apk add --no-cache ca-certificates tzdata

# Create unprivileged non-root system user and group (appuser: UID/GID 10001)
RUN addgroup -g 10001 appuser && \
    adduser -u 10001 -G appuser -D -h /app -s /sbin/nologin appuser

# Copy static binary from builder
COPY --from=builder /nexus-api /nexus-api
RUN chmod 0755 /nexus-api

# Working directory
WORKDIR /app

# Switch to unprivileged non-root user
USER appuser

# Expose HTTP API port
EXPOSE 8080

# Container healthcheck targeting /healthz
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

# Service entrypoint
ENTRYPOINT ["/nexus-api"]
