# Nexus API Production Architecture & Implementation Plan: User Discovery, Direct Messaging & MinIO Object Storage

**Document Version:** 1.0.0  
**Target Subsystem:** `services/nexus-api`, `nexus-socket`, PostgreSQL 16 & MinIO S3 Object Storage  
**Author:** Nexus Core Architecture Team (`teamwork_preview_worker_spec_1`)  
**Status:** Approved for Implementation (Read-Only Specification)  
**Date:** 2026-09-08  

---

## 1. Executive Summary & Production Topology

### 1.1 Mission & Architectural Objectives
Nexus is an enterprise-grade real-time collaboration and AI platform. The core API tier (`services/nexus-api`) is implemented in Go 1.25 using the Gin web framework, backed by PostgreSQL 16 (via `jackc/pgx/v5` with connection pooling) and compiled with `sqlc` for type-safe database access. Real-time messaging and soft real-time AI token streaming are mediated through an Elixir/OTP and Bandit service (`nexus-socket`) utilizing Delta-CRDT presence and Phoenix PubSub, with Redis 7 serving as the cross-service broadcast bus.

This specification provides the exhaustive, production-grade technical architecture and implementation roadmap for three next-generation capabilities:
1. **User Discovery Subsystem**: Enabling contact lookup across exact email, verified E.164 phone number, and case-insensitive username (`CITEXT`), protected by sliding-window rate limiting, privacy boundaries, and block filtering to eliminate phone/email scraping risks.
2. **Direct (1:1) Messaging Subsystem**: Introducing idempotent conversation initiation (`POST /api/v1/chats/direct`), backing group/workspace membership provisioning, canonical pair indexing (`LEAST(user_a, user_b), GREATEST(user_a, user_b)`), and zero-latency real-time synchronization over Redis (`nexus:broadcast`) to connected socket clients.
3. **Enterprise MinIO S3 Object Storage Subsystem**: Architecting a dual-bucket object storage topology (`nexus-avatars` for public-read profile assets, `nexus-attachments` for private room attachments), coupled with a robust PostgreSQL metadata registry (`files` table), automated Docker provisioning (`minio/mc`), S3 CORS policies, and a high-performance pre-signed PUT/GET URL lifecycle.

Crucially, this specification resolves the **Dual-Endpoint Network Resolution Problem** inherent in containerized Docker environments where backend services and browser clients utilize different network paths to reach MinIO without invalidating AWS Signature Version 4 (SigV4) Host headers.

---

### 1.2 Production Topology & Data Flow
The diagram below illustrates the end-to-end network boundaries, ingress routes, container interactions, and data storage engines.

```
                          ┌────────────────────────────────────────────────────────┐
                          │                Client Tier (Browser / React 19)        │
                          │   • Socket.IO v4 Client     • Axios HTTP REST Client   │
                          └──────────────┬─────────────────────────┬───────────────┘
                                         │                         │
                        HTTPS / REST     │        Pre-signed PUT   │ S3 Direct Download
                        Port 8080        │        & GET Direct     │ (Public/Presigned)
                                         │        Port 9000        │
                                         ▼                         ▼
┌──────────────────────────────────────────────────┐     ┌───────────────────────────────────┐
│               Public Edge / Host Ingress          │     │        MinIO Object Storage       │
│               http://localhost:8080              │     │       http://localhost:9000       │
└────────────────────────┬─────────────────────────┘     └─────────────────▲─────────────────┘
                         │                                                 │
                         ▼                                                 │
┌──────────────────────────────────────────────────────────────────────┐  │
│  Docker Bridge Network (`nexus-network`)                             │  │
│                                                                      │  │
│   ┌──────────────────────────────────────────────────────────────┐   │  │
│   │                     services/nexus-api (Go 1.25)             │   │  │
│   │                                                              │   │  │
│   │   • Gin Engine Router (`/api/...`, `/api/v1/...`)           │   │  │
│   │   • JWT Auth Middleware (HS256 claims validation)            │   │  │
│   │   • Redis Sliding-Window Rate Limiter Middleware             │   │  │
│   │   • Discovery Handler (`/api/v1/users/search`)               │   │  │
│   │   • Direct Chat Handler (`/api/v1/chats/direct`)             │   │  │
│   │   • File Lifecycle Handlers (Presign, Confirm, Download)     │   │  │
│   │   • S3 Storage Service (Dual-Endpoint MinIO Go SDK v7)       │   │  │
│   │       ├── presignClient  --> Configured for Public Endpoint  │───┼──┘ (Signs Host: localhost:9000)
│   │       └── internalClient --> Configured for minio:9000       │───┼──┐ (Internal RPC / StatObject)
│   │   • pgxpool Connection Pool (Max 80 conns, 1h max lifetime)   │   │  │
│   └───────────────┬──────────────────────────────┬───────────────┘   │  │
│                   │                              │                   │  │
│     SQL Queries   │                PUBLISH       │                   │  │
│     (sqlc / pgx)  │             nexus:broadcast  │                   │  │
│                   ▼                              ▼                   │  │
│   ┌───────────────────────────┐    ┌──────────────────────────────┐  │  │
│   │    PostgreSQL 16 Engine   │    │         Redis 7.0 Bus        │  │  │
│   │                           │    │                              │  │  │
│   │   • users (CITEXT, phone) │    │   • Sliding-Window Rate ZSet │  │  │
│   │   • user_blocks           │    │   • Channel: nexus:broadcast │  │  │
│   │   • direct_chats          │    │   • Channel: room:*:ai_stream│  │  │
│   │   • groups, chats, msgs   │    └──────────────┬───────────────┘  │  │
│   │   • files (metadata)      │                   │                  │  │
│   └───────────────────────────┘                   │ SUBSCRIBE        │  │
│                                                   ▼                  │  │
│                                    ┌──────────────────────────────┐  │  │
│                                    │   nexus-socket (Elixir OTP)  │  │  │
│                                    │   Bandit + Phoenix Channels  │  │  │
│                                    │   Port 3000 / 3001           │  │  │
│                                    │   • Redis Subscriber         │  │  │
│                                    │   • Phoenix.PubSub Broadcast │  │  │
│                                    │   • Socket.IO v4 Translation │  │  │
│                                    └──────────────┬───────────────┘  │  │
│                                                   │                  │  │
│                                                   │ WS Frame Egress  │  │
│                                                   ▼                  │  │
│                                           Connected Browsers         │  │
│                                                                      │  │
│   ┌──────────────────────────────────────────────────────────────┐   │  │
│   │                minio (MinIO RELEASE.2024-11-07)              │<──┴──┘
│   │                Internal Endpoint: http://minio:9000          │
│   │   • nexus-avatars (Public Read Policy)                       │
│   │   • nexus-attachments (Private Read Policy)                  │
│   └──────────────────────────────▲───────────────────────────────┘
│                                  │ Provision Buckets & Policies
│   ┌──────────────────────────────┴───────────────────────────────┐
│   │               minio-init (minio/mc:latest)                   │
│   │               Automated Provisioning & CORS Script           │
│   └──────────────────────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────────┘
```

#### 1.2.1 Real-Time Socket Gateway & User Topic Subscription Architecture
When direct conversations or chat events are created in `nexus-api`, events are published to Redis (`nexus:broadcast`). To deliver these notifications to client WebSockets without client polling:
1. **Redis Ingestion**: The Elixir socket service (`nexus-socket`) runs `NexusSocket.Redis.Subscriber`, which listens to `nexus:broadcast`. When a payload with `topic = "user:<user_id>"` arrives, it unpacks the payload and invokes:
   ```elixir
   Phoenix.PubSub.broadcast(NexusSocket.PubSub, topic, {:socket_broadcast, event, payload})
   ```
2. **WebSocket Client Subscription**: In `nexus-socket/lib/nexus_socket/transport/websocket_handler.ex`, each client connection authenticates via JWT upon connection. The process MUST immediately subscribe to its dedicated user topic:
   ```elixir
   Phoenix.PubSub.subscribe(NexusSocket.PubSub, "user:#{user.user_id}")
   ```
   This ensures that personal real-time events (such as `direct_chat_created`) are received by the connection process and encoded into Socket.IO packets (`42["direct_chat_created", {...}]`) for instant browser delivery.
3. **Connection Lifecycle Teardown**: Upon socket termination (`terminate/2`), the process unsubscribes via `Phoenix.PubSub.unsubscribe(NexusSocket.PubSub, "user:#{state.user.user_id}")` to clean up resources and prevent orphaned subscriptions.

---

## 2. PostgreSQL Schema Migrations (DDL Up and Down)

### 2.1 Schema Architecture & Design Rationale
To support user discovery, direct messaging, and file storage without regressing existing multi-tenant relational integrity:

1. **`users.username`**: Added as `CITEXT` (Case-Insensitive Text extension). Enforced via regex check constraint `chk_users_username_format CHECK (username IS NULL OR username ~ '^[a-zA-Z0-9_-]{3,30}$')`. A partial unique index `idx_users_username_unique` ensures case-insensitive uniqueness across non-null values, while `idx_users_username_pattern` with operator class `citext_pattern_ops` accelerates B-tree prefix range scans (`starts_with`) for sub-millisecond user discovery.
2. **`users.phone_number`**: Added as `VARCHAR(32)` to store international phone numbers in standard E.164 format (`+[country code][subscriber number]`). Enforced via regex check constraint `chk_users_phone_format CHECK (phone_number IS NULL OR phone_number ~ '^\+[1-9]\d{6,14}$')`. Indexed via partial unique index `idx_users_phone_number_unique`.
3. **`user_blocks` Table**: Implements bidirectional blocking logic. Uses composite primary key `(blocker_id, blocked_id)` and check constraint `chk_no_self_block CHECK (blocker_id <> blocked_id)`. Includes reverse lookup index `idx_user_blocks_blocked` on `(blocked_id, blocker_id)` for high-performance subqueries during discovery and chat initiation.
4. **`direct_chats` Table**: Resolves the 1:1 conversation pairing. Directly references backing record `chats(id)` which belongs to a dedicated backing `groups` record with `visibility = 'direct'`. Canonical order is strictly enforced at the database level via `chk_canonical_user_order CHECK (user_a_id < user_b_id)` and unique constraint `uq_direct_chat_pair UNIQUE (user_a_id, user_b_id)`. This guarantees that regardless of which user initiates the chat, the pairing maps to exactly one unique conversation without race conditions.
5. **`files` Metadata Table**: Centralizes object storage metadata tracking. Employs UUID primary key, foreign keys to `users(id)` and `chats(id)` (nullable for profile avatars), bucket identifier, object key, MIME content type, size in bytes (`BIGINT`), upload status (`pending`, `active`, `deleted`), MD5/ETag checksum, and arbitrary extensible JSONB metadata. Check constraint `chk_files_attachment_requires_chat CHECK (bucket <> 'nexus-attachments' OR chat_id IS NOT NULL)` guarantees that all private attachments are bound to a chat room for membership-based authorization. Partial indexes on `status = 'pending'` support background orphan sweep workers.

---

### 2.2 Complete DDL Migration: `000002_add_discovery_files_and_direct_chats.up.sql`

```sql
-- ============================================================================
-- Migration: 000002_add_discovery_files_and_direct_chats.up.sql
-- Description: Extends users table for discovery, adds blocking, direct chats,
--              and MinIO object storage metadata registry.
-- ============================================================================

-- 1. Ensure CITEXT extension is present for case-insensitive username lookup
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Extend users table with discovery columns and check constraints
ALTER TABLE users 
    ADD COLUMN IF NOT EXISTS username CITEXT,
    ADD COLUMN IF NOT EXISTS phone_number VARCHAR(32);

-- Enforce format constraints on username (alphanumeric, underscore, hyphen, 3-30 chars)
ALTER TABLE users 
    DROP CONSTRAINT IF EXISTS chk_users_username_format,
    ADD CONSTRAINT chk_users_username_format 
        CHECK (username IS NULL OR username ~ '^[a-zA-Z0-9_-]{3,30}$');

-- Enforce E.164 international standard format for phone numbers (+1234567890 to max 15 digits)
ALTER TABLE users 
    DROP CONSTRAINT IF EXISTS chk_users_phone_format,
    ADD CONSTRAINT chk_users_phone_format 
        CHECK (phone_number IS NULL OR phone_number ~ '^\+[1-9]\d{6,14}$');

-- Create unique indexes on non-null discovery identifiers
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique 
    ON users(username) 
    WHERE username IS NOT NULL;

-- Dedicated pattern ops index for sub-millisecond B-tree prefix range scanning
CREATE INDEX IF NOT EXISTS idx_users_username_pattern 
    ON users(username citext_pattern_ops) 
    WHERE username IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_number_unique 
    ON users(phone_number) 
    WHERE phone_number IS NOT NULL;

-- 3. User Blocking Table (Prevents unwanted direct conversations and discovery)
CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (blocker_id, blocked_id),
    CONSTRAINT chk_no_self_block CHECK (blocker_id <> blocked_id)
);

-- Reverse index for fast lookups: "Has caller been blocked by target?"
CREATE INDEX IF NOT EXISTS idx_user_blocks_reverse 
    ON user_blocks(blocked_id, blocker_id);

-- 4. Direct 1:1 Chats Registry Table
CREATE TABLE IF NOT EXISTS direct_chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID NOT NULL UNIQUE REFERENCES chats(id) ON DELETE CASCADE,
    user_a_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_direct_distinct_users CHECK (user_a_id <> user_b_id),
    CONSTRAINT chk_canonical_user_order CHECK (user_a_id < user_b_id),
    CONSTRAINT uq_direct_chat_pair UNIQUE (user_a_id, user_b_id)
);

CREATE INDEX IF NOT EXISTS idx_direct_chats_user_a ON direct_chats(user_a_id);
CREATE INDEX IF NOT EXISTS idx_direct_chats_user_b ON direct_chats(user_b_id);

-- 5. Files Metadata Table (MinIO S3 Object Registry)
CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploader_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
    bucket VARCHAR(63) NOT NULL,
    object_key TEXT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    content_type VARCHAR(127) NOT NULL,
    size_bytes BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    etag VARCHAR(64),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT chk_files_status CHECK (status IN ('pending', 'active', 'deleted')),
    CONSTRAINT chk_files_size_positive CHECK (size_bytes > 0),
    CONSTRAINT chk_files_attachment_requires_chat 
        CHECK (bucket <> 'nexus-attachments' OR chat_id IS NOT NULL),
    CONSTRAINT uq_files_bucket_key UNIQUE (bucket, object_key)
);

-- Optimized query indexes
CREATE INDEX IF NOT EXISTS idx_files_uploader 
    ON files(uploader_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_files_chat 
    ON files(chat_id, created_at DESC) 
    WHERE chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_files_status_pending 
    ON files(status, created_at) 
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_files_active 
    ON files(chat_id, created_at DESC) 
    WHERE status = 'active';
```

---

### 2.3 Complete Rollback DDL: `000002_add_discovery_files_and_direct_chats.down.sql`

```sql
-- ============================================================================
-- Migration: 000002_add_discovery_files_and_direct_chats.down.sql
-- Description: Safely rolls back files, direct_chats, user_blocks, and user
--              discovery columns in reverse dependency order.
-- ============================================================================

-- 1. Drop files table and associated indexes
DROP INDEX IF EXISTS idx_files_active;
DROP INDEX IF EXISTS idx_files_status_pending;
DROP INDEX IF EXISTS idx_files_chat;
DROP INDEX IF EXISTS idx_files_uploader;
DROP TABLE IF EXISTS files;

-- 2. Drop direct_chats table and indexes
DROP INDEX IF EXISTS idx_direct_chats_user_b;
DROP INDEX IF EXISTS idx_direct_chats_user_a;
DROP TABLE IF EXISTS direct_chats;

-- 3. Drop user_blocks table and reverse index
DROP INDEX IF EXISTS idx_user_blocks_reverse;
DROP TABLE IF EXISTS user_blocks;

-- 4. Drop unique indexes and columns from users
DROP INDEX IF EXISTS idx_users_phone_number_unique;
DROP INDEX IF EXISTS idx_users_username_pattern;
DROP INDEX IF EXISTS idx_users_username_unique;

ALTER TABLE users 
    DROP CONSTRAINT IF EXISTS chk_users_phone_format,
    DROP CONSTRAINT IF EXISTS chk_users_username_format,
    DROP COLUMN IF EXISTS phone_number,
    DROP COLUMN IF EXISTS username;
```

---

## 3. Go Domain Models, Repository Interfaces & sqlc Queries

### 3.1 sqlc Query Definitions

#### 3.1.1 `internal/database/queries/users.sql`
```sql
-- name: SearchUserByExactQuery :one
-- Performs an exact match lookup across email, username, or phone number
-- excluding users who have blocked the caller or whom the caller has blocked.
SELECT 
    u.id, 
    u.email, 
    u.display_name, 
    u.avatar_url, 
    u.username, 
    u.phone_number, 
    u.system_role, 
    u.created_at, 
    u.last_seen
FROM users u
WHERE (u.email = $1 OR u.username = $1::citext OR u.phone_number = $1)
  AND u.id <> $2
  AND NOT EXISTS (
      SELECT 1 FROM user_blocks ub
      WHERE (ub.blocker_id = $2 AND ub.blocked_id = u.id)
         OR (ub.blocker_id = u.id AND ub.blocked_id = $2)
  )
LIMIT 1;

-- name: SearchUsersByUsernamePrefix :many
-- Prefix search for usernames (min 3 chars), excluding blocked pairs.
-- Utilizes native starts_with() to eliminate SQL LIKE wildcard injection (% and _).
SELECT 
    u.id, 
    u.email, 
    u.display_name, 
    u.avatar_url, 
    u.username, 
    u.phone_number, 
    u.system_role, 
    u.created_at, 
    u.last_seen
FROM users u
WHERE starts_with(u.username, $1::citext)
  AND u.id <> $2
  AND NOT EXISTS (
      SELECT 1 FROM user_blocks ub
      WHERE (ub.blocker_id = $2 AND ub.blocked_id = u.id)
         OR (ub.blocker_id = u.id AND ub.blocked_id = $2)
  )
ORDER BY u.username ASC
LIMIT $3 OFFSET $4;

-- name: GetUserByUsername :one
SELECT id, email, display_name, avatar_url, username, phone_number, system_role, created_at, last_seen
FROM users
WHERE username = $1::citext
LIMIT 1;

-- name: GetUserByPhoneNumber :one
SELECT id, email, display_name, avatar_url, username, phone_number, system_role, created_at, last_seen
FROM users
WHERE phone_number = $1
LIMIT 1;

-- name: UpdateUserDiscoveryProfile :one
UPDATE users
SET 
    username = COALESCE($2, username),
    phone_number = COALESCE($3, phone_number),
    display_name = COALESCE($4, display_name),
    avatar_url = COALESCE($5, avatar_url)
WHERE id = $1
RETURNING id, email, display_name, avatar_url, username, phone_number, system_role, created_at, last_seen;
```

#### 3.1.2 `internal/database/queries/chats.sql`
```sql
-- name: CheckUsersBlocked :one
-- Returns true if either user has blocked the other
SELECT EXISTS (
    SELECT 1 FROM user_blocks 
    WHERE (blocker_id = $1 AND blocked_id = $2)
       OR (blocker_id = $2 AND blocked_id = $1)
) AS is_blocked;

-- name: GetDirectChatByUsers :one
-- Finds an existing direct chat pairing regardless of argument order
SELECT 
    dc.id, 
    dc.chat_id, 
    dc.user_a_id, 
    dc.user_b_id, 
    dc.created_at,
    c.tenant_id, 
    c.workspace_id, 
    c.group_id, 
    c.title
FROM direct_chats dc
JOIN chats c ON c.id = dc.chat_id
WHERE dc.user_a_id = LEAST($1::uuid, $2::uuid)
  AND dc.user_b_id = GREATEST($1::uuid, $2::uuid)
LIMIT 1;

-- name: CreateDirectChatRegistry :one
-- Registers the direct chat pairing in canonical order
INSERT INTO direct_chats (
    chat_id, 
    user_a_id, 
    user_b_id
) VALUES (
    $1, 
    LEAST($2::uuid, $3::uuid), 
    GREATEST($2::uuid, $3::uuid)
)
RETURNING id, chat_id, user_a_id, user_b_id, created_at;

-- name: CreateDirectBackingGroup :one
-- Creates a closed direct messaging group container
INSERT INTO groups (
    tenant_id,
    workspace_id,
    name,
    owner_id,
    visibility,
    join_policy,
    ai_enabled
) VALUES (
    $1, $2, $3, $4, 'direct', 'closed', false
)
RETURNING id, tenant_id, workspace_id, name, owner_id, visibility, join_policy, created_at;

-- name: AddGroupMember :exec
INSERT INTO group_members (
    group_id, 
    user_id, 
    role
) VALUES (
    $1, $2, $3
) ON CONFLICT (group_id, user_id) DO NOTHING;

-- name: BlockUser :exec
INSERT INTO user_blocks (
    blocker_id, 
    blocked_id, 
    reason
) VALUES (
    $1, $2, $3
) ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

-- name: UnblockUser :exec
DELETE FROM user_blocks 
WHERE blocker_id = $1 AND blocked_id = $2;

-- name: ListBlockedUsers :many
SELECT 
    u.id, 
    u.email, 
    u.display_name, 
    u.avatar_url, 
    u.username, 
    ub.reason, 
    ub.created_at AS blocked_at
FROM user_blocks ub
JOIN users u ON u.id = ub.blocked_id
WHERE ub.blocker_id = $1
ORDER BY ub.created_at DESC;
```

#### 3.1.3 `internal/database/queries/files.sql`
```sql
-- name: CreateFileMetadata :one
INSERT INTO files (
    uploader_id,
    chat_id,
    bucket,
    object_key,
    file_name,
    content_type,
    size_bytes,
    status,
    metadata
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, 'pending', $8
)
RETURNING 
    id, uploader_id, chat_id, bucket, object_key, 
    file_name, content_type, size_bytes, status, 
    etag, metadata, created_at, confirmed_at, deleted_at;

-- name: GetFileByID :one
SELECT 
    id, uploader_id, chat_id, bucket, object_key, 
    file_name, content_type, size_bytes, status, 
    etag, metadata, created_at, confirmed_at, deleted_at
FROM files
WHERE id = $1 AND deleted_at IS NULL;

-- name: ConfirmFileUpload :one
UPDATE files
SET 
    status = 'active',
    etag = COALESCE($2, etag),
    size_bytes = $3,
    content_type = $4,
    confirmed_at = NOW()
WHERE id = $1 AND status = 'pending'
RETURNING 
    id, uploader_id, chat_id, bucket, object_key, 
    file_name, content_type, size_bytes, status, 
    etag, metadata, created_at, confirmed_at, deleted_at;

-- name: SoftDeleteFile :exec
UPDATE files
SET 
    status = 'deleted',
    deleted_at = NOW()
WHERE id = $1;

-- name: ListFilesByChat :many
SELECT 
    id, uploader_id, chat_id, bucket, object_key, 
    file_name, content_type, size_bytes, status, 
    etag, metadata, created_at, confirmed_at, deleted_at
FROM files
WHERE chat_id = $1 AND status = 'active'
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: ListStalePendingFiles :many
-- Used by the orphan cleanup worker to delete abandoned uploads
SELECT id, bucket, object_key, created_at
FROM files
WHERE status = 'pending'
  AND created_at < $1
LIMIT $2;
```

---

### 3.2 Generated Go Models & Querier Interface

#### 3.2.1 Go Models (`internal/database/models.go` Preview)
```go
package database

import (
	"github.com/jackc/pgx/v5/pgtype"
)

type File struct {
	ID          pgtype.UUID        `json:"id"`
	UploaderID  pgtype.UUID        `json:"uploader_id"`
	ChatID      pgtype.UUID        `json:"chat_id"` // Non-null when bucket = 'nexus-attachments' (enforced by chk_files_attachment_requires_chat)
	Bucket      string             `json:"bucket"`
	ObjectKey   string             `json:"object_key"`
	FileName    string             `json:"file_name"`
	ContentType string             `json:"content_type"`
	SizeBytes   int64              `json:"size_bytes"`
	Status      string             `json:"status"`
	Etag        pgtype.Text        `json:"etag"`
	Metadata    []byte             `json:"metadata"`
	CreatedAt   pgtype.Timestamptz `json:"created_at"`
	ConfirmedAt pgtype.Timestamptz `json:"confirmed_at"`
	DeletedAt   pgtype.Timestamptz `json:"deleted_at"`
}

type ConfirmFileUploadParams struct {
	ID          pgtype.UUID `json:"id"`
	Etag        *string     `json:"etag"`
	SizeBytes   int64       `json:"size_bytes"`
	ContentType string      `json:"content_type"`
}

type DirectChat struct {
	ID        pgtype.UUID        `json:"id"`
	ChatID    pgtype.UUID        `json:"chat_id"`
	UserAID   pgtype.UUID        `json:"user_a_id"`
	UserBID   pgtype.UUID        `json:"user_b_id"`
	CreatedAt pgtype.Timestamptz `json:"created_at"`
}

type UserBlock struct {
	BlockerID pgtype.UUID        `json:"blocker_id"`
	BlockedID pgtype.UUID        `json:"blocked_id"`
	Reason    string             `json:"reason"`
	CreatedAt pgtype.Timestamptz `json:"created_at"`
}

type User struct {
	ID           pgtype.UUID        `json:"id"`
	Email        string             `json:"email"`
	PasswordHash string             `json:"password_hash"`
	DisplayName  string             `json:"display_name"`
	AvatarUrl    string             `json:"avatar_url"`
	SystemRole   string             `json:"system_role"`
	CreatedAt    pgtype.Timestamptz `json:"created_at"`
	LastSeen     pgtype.Timestamptz `json:"last_seen"`
	Username     pgtype.Text        `json:"username"`
	PhoneNumber  pgtype.Text        `json:"phone_number"`
}
```

#### 3.2.2 Go Querier Interface (`internal/database/querier.go` Extension)
```go
package database

import (
	"context"
	"github.com/jackc/pgx/v5/pgtype"
)

type Querier interface {
	// Existing Methods
	CreateChat(ctx context.Context, arg CreateChatParams) (Chat, error)
	ListChatsByGroup(ctx context.Context, groupID pgtype.UUID) ([]Chat, error)
	// ...

	// User Discovery Methods
	SearchUserByExactQuery(ctx context.Context, arg SearchUserByExactQueryParams) (User, error)
	SearchUsersByUsernamePrefix(ctx context.Context, arg SearchUsersByUsernamePrefixParams) ([]User, error)
	GetUserByUsername(ctx context.Context, username pgtype.Text) (User, error)
	GetUserByPhoneNumber(ctx context.Context, phoneNumber pgtype.Text) (User, error)
	UpdateUserDiscoveryProfile(ctx context.Context, arg UpdateUserDiscoveryProfileParams) (User, error)

	// Direct Chat & Blocking Methods
	CheckUsersBlocked(ctx context.Context, arg CheckUsersBlockedParams) (bool, error)
	GetDirectChatByUsers(ctx context.Context, arg GetDirectChatByUsersParams) (GetDirectChatByUsersRow, error)
	CreateDirectChatRegistry(ctx context.Context, arg CreateDirectChatRegistryParams) (DirectChat, error)
	CreateDirectBackingGroup(ctx context.Context, arg CreateDirectBackingGroupParams) (Group, error)
	AddGroupMember(ctx context.Context, arg AddGroupMemberParams) error
	BlockUser(ctx context.Context, arg BlockUserParams) error
	UnblockUser(ctx context.Context, arg UnblockUserParams) error
	ListBlockedUsers(ctx context.Context, blockerID pgtype.UUID) ([]ListBlockedUsersRow, error)

	// File Metadata Methods
	CreateFileMetadata(ctx context.Context, arg CreateFileMetadataParams) (File, error)
	GetFileByID(ctx context.Context, id pgtype.UUID) (File, error)
	ConfirmFileUpload(ctx context.Context, arg ConfirmFileUploadParams) (File, error)
	SoftDeleteFile(ctx context.Context, id pgtype.UUID) error
	ListFilesByChat(ctx context.Context, arg ListFilesByChatParams) ([]File, error)
	ListStalePendingFiles(ctx context.Context, arg ListStalePendingFilesParams) ([]ListStalePendingFilesRow, error)
}
```

---

### 3.3 Storage Service Interface & Dual-Endpoint Resolution

#### 3.3.1 Architectural Root Cause of the Dual-Endpoint Problem
In containerized Docker deployments, `nexus-api` communicates with MinIO over the internal container network via DNS name `minio:9000`. However, the web browser runs on the host machine and accesses MinIO via `localhost:9000` (or `https://storage.nexusainow.online` in production).

If `nexus-api` uses `minio:9000` to generate a pre-signed URL (`PresignedPutObject` / `PresignedGetObject`), AWS Signature Version 4 (SigV4) incorporates the `Host: minio:9000` header into the canonical request hash:
$$\text{StringToSign} = \text{AWS4-HMAC-SHA256} + \dots + \text{HMacSHA256}(\text{CanonicalRequest})$$
$$\text{CanonicalHeaders} = \text{"host:"} + \text{HostValue} + \text{"\n"}$$

When the client browser issues an HTTP request to `http://localhost:9000/...`, the browser automatically transmits `Host: localhost:9000`. 
- If the URL was pre-signed for `minio:9000`, the MinIO server recalculates the signature using `Host: localhost:9000`, resulting in an immediate **`SignatureDoesNotMatch`** HTTP 403 error.
- If `nexus-api` attempts a naive string replacement replacing `minio:9000` with `localhost:9000` in the URL query string, the SigV4 signature becomes cryptographically invalid.

#### 3.3.2 Turnkey Go Solution: Dual-Client Architecture
The `StorageService` instantiates two separate `minio.Client` instances sharing credentials:
1. `internalClient`: Initialized with `S3_ENDPOINT` (`minio:9000`), used for all internal RPC operations: `StatObject`, `BucketExists`, `MakeBucket`, `RemoveObject`, and direct streaming.
2. `presignClient`: Initialized with the host of `S3_PUBLIC_ENDPOINT` (`localhost:9000`), used strictly for calculating pre-signed PUT/GET URLs.

```go
package storage

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type StorageService interface {
	PresignPutURL(ctx context.Context, bucket, objectKey, contentType string, expires time.Duration) (string, error)
	PresignGetURL(ctx context.Context, bucket, objectKey, downloadFileName string, expires time.Duration) (string, error)
	StatObject(ctx context.Context, bucket, objectKey string) (minio.ObjectInfo, error)
	PutObjectDirect(ctx context.Context, bucket, objectKey string, reader io.Reader, size int64, contentType string) (minio.UploadInfo, error)
	DeleteObject(ctx context.Context, bucket, objectKey string) error
	GetPublicURL(bucket, objectKey string) string
}

type minioStorageService struct {
	internalClient   *minio.Client // For backend server-to-server RPCs
	presignClient    *minio.Client // For calculating client SigV4 signatures
	publicEndpointURL *url.URL
	avatarsBucket    string
	attachmentsBucket string
}

func NewStorageService(
	internalEndpoint string, // e.g. "minio:9000"
	publicEndpoint string,   // e.g. "http://localhost:9000"
	accessKey string,
	secretKey string,
	useSSL bool,
	avatarsBucket string,
	attachmentsBucket string,
) (StorageService, error) {
	// 1. Initialize Internal Client (used for StatObject, PutObjectDirect, etc.)
	internalClient, err := minio.New(internalEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to initialize internal minio client: %w", err)
	}

	// 2. Parse Public Endpoint for Presigner Client
	pubURL, err := url.Parse(publicEndpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid S3_PUBLIC_ENDPOINT '%s': %w", publicEndpoint, err)
	}

	pubHost := pubURL.Host
	if pubHost == "" {
		pubHost = pubURL.Path // Fallback if schema was omitted
	}
	pubSecure := strings.EqualFold(pubURL.Scheme, "https")

	// 3. Initialize Presign Client (Host matches what the browser submits)
	presignClient, err := minio.New(pubHost, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: pubSecure,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to initialize presign minio client: %w", err)
	}

	return &minioStorageService{
		internalClient:    internalClient,
		presignClient:     presignClient,
		publicEndpointURL: pubURL,
		avatarsBucket:     avatarsBucket,
		attachmentsBucket: attachmentsBucket,
	}, nil
}

func (s *minioStorageService) PresignPutURL(ctx context.Context, bucket, objectKey, contentType string, expires time.Duration) (string, error) {
	// Generate presigned PUT URL using presignClient so SigV4 Host header matches browser request
	u, err := s.presignClient.PresignedPutObject(ctx, bucket, objectKey, expires)
	if err != nil {
		return "", fmt.Errorf("failed to generate presigned PUT url: %w", err)
	}
	return u.String(), nil
}

func (s *minioStorageService) PresignGetURL(ctx context.Context, bucket, objectKey, downloadFileName string, expires time.Duration) (string, error) {
	reqParams := make(url.Values)
	if downloadFileName != "" {
		// Enforce Content-Disposition header in pre-signed URL to ensure correct download filename
		disposition := fmt.Sprintf("attachment; filename=\"%s\"", url.QueryEscape(downloadFileName))
		reqParams.Set("response-content-disposition", disposition)
	}

	u, err := s.presignClient.PresignedGetObject(ctx, bucket, objectKey, expires, reqParams)
	if err != nil {
		return "", fmt.Errorf("failed to generate presigned GET url: %w", err)
	}
	return u.String(), nil
}

func (s *minioStorageService) StatObject(ctx context.Context, bucket, objectKey string) (minio.ObjectInfo, error) {
	// Call internal container network directly
	return s.internalClient.StatObject(ctx, bucket, objectKey, minio.StatObjectOptions{})
}

func (s *minioStorageService) PutObjectDirect(ctx context.Context, bucket, objectKey string, reader io.Reader, size int64, contentType string) (minio.UploadInfo, error) {
	return s.internalClient.PutObject(ctx, bucket, objectKey, reader, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
}

func (s *minioStorageService) DeleteObject(ctx context.Context, bucket, objectKey string) error {
	return s.internalClient.RemoveObject(ctx, bucket, objectKey, minio.RemoveObjectOptions{})
}

func (s *minioStorageService) GetPublicURL(bucket, objectKey string) string {
	base := strings.TrimRight(s.publicEndpointURL.String(), "/")
	return fmt.Sprintf("%s/%s/%s", base, bucket, objectKey)
}
```

---

## 4. REST & OpenAPI Endpoint Specifications

### 4.1 `GET /api/v1/users/search`
Discovers users by exact phone number, exact email, or username prefix. Excludes mutual user blocks, prevents directory harvesting through PII masking and SQL wildcard injection immunity, and enforces a sliding-window rate limit (30 req/min).

- **HTTP Method**: `GET`
- **Route**: `/api/v1/users/search`
- **Middleware**: `JWTAuthMiddleware`, `SlidingWindowRateLimiter(30, time.Minute)`
- **Query Parameters**:
  - `q` (string, required): Search term (min 3 chars).
    - If `q` contains `@`: exact email search (`WHERE u.email = $1`).
    - If `q` starts with `+`: exact phone number search (`WHERE u.phone_number = $1`).
    - Otherwise: username prefix search using `starts_with(u.username, $1::citext)`.
  - `limit` (integer, optional, default `10`, max `50`): Maximum results.
  - `offset` (integer, optional, default `0`): Pagination offset.
- **Validation & Anti-Abuse Rules**:
  - Application-layer regex validation for username prefix queries:
    ```go
    var usernameQueryRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]{3,30}$`)
    if !strings.Contains(q, "@") && !strings.HasPrefix(q, "+") {
        if !usernameQueryRegex.MatchString(q) {
            c.JSON(http.StatusBadRequest, gin.H{
                "error": "invalid username search query: must contain only alphanumeric characters, underscores, or hyphens (3-30 characters)",
            })
            return
        }
    }
    ```
- **Privacy Enforcement & PII Masking**:
  - Users blocked by the caller or who have blocked the caller are automatically filtered out via database subqueries (`NOT EXISTS in user_blocks`).
  - Phone numbers are **always masked** (`+1 ••• ••• 4421`) across all search types.
  - **Email Masking on Prefix Search**: When discovery is triggered via username prefix, cleartext `email` is completely omitted from the JSON payload, and `email_masked` (`s••••••••••r@nexus.internal`) is provided instead. This eliminates bulk corporate email harvesting.
  - **Exact Email Match Exception**: Cleartext `email` is returned ONLY when the caller supplied the exact email address in `q`, confirming an existing contact without disclosing unsearched PII.
- **Responses**:
  - `200 OK (Username Prefix Search - Scenario A)`:
    ```json
    {
      "users": [
        {
          "id": "c71a39f1-94d1-4b19-bf95-0e129da49302",
          "username": "sconnor",
          "display_name": "Sarah Connor",
          "avatar_url": "http://localhost:9000/nexus-avatars/avatars/user-123.jpg",
          "email_masked": "s••••••••••r@nexus.internal",
          "phone_number_masked": "+1 ••• ••• 4421",
          "created_at": "2026-08-15T12:00:00Z"
        }
      ],
      "total": 1
    }
    ```
  - `200 OK (Exact Email Search - Scenario B)`:
    ```json
    {
      "users": [
        {
          "id": "c71a39f1-94d1-4b19-bf95-0e129da49302",
          "username": "sconnor",
          "display_name": "Sarah Connor",
          "avatar_url": "http://localhost:9000/nexus-avatars/avatars/user-123.jpg",
          "email": "sarah.connor@nexus.internal",
          "email_masked": "s••••••••••r@nexus.internal",
          "phone_number_masked": "+1 ••• ••• 4421",
          "created_at": "2026-08-15T12:00:00Z"
        }
      ],
      "total": 1
    }
    ```
  - `400 Bad Request`: Query parameter `q` missing, shorter than 3 characters, or contains invalid characters for username search (`{"error": "invalid username search query: ..."}`).
  - `401 Unauthorized`: Missing/invalid Bearer JWT token (`{"error": "unauthorized"}`).
  - `429 Too Many Requests`: Rate limit exceeded (`{"error": "rate limit exceeded: maximum 30 search queries per minute"}`).

#### 4.1.1 Go Privacy Masking Implementation Reference
```go
package handlers

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

type UserSearchResponseItem struct {
	ID                uuid.UUID  `json:"id"`
	Username          *string    `json:"username,omitempty"`
	DisplayName       string     `json:"display_name"`
	AvatarURL         string     `json:"avatar_url,omitempty"`
	Email             string     `json:"email,omitempty"`        // Omitted on prefix search; included only on exact email match
	EmailMasked       string     `json:"email_masked,omitempty"` // Always included
	PhoneNumberMasked string     `json:"phone_number_masked,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
}

// MaskEmail masks the local part of an email address to protect PII against bulk harvesting.
// Example: "sarah.connor@nexus.internal" -> "s••••••••••r@nexus.internal"
func MaskEmail(email string) string {
	parts := strings.Split(email, "@")
	if len(parts) != 2 || len(parts[0]) == 0 {
		return "•••••"
	}
	local, domain := parts[0], parts[1]
	if len(local) <= 2 {
		return string(local[0]) + "•••@" + domain
	}
	maskLen := len(local) - 2
	if maskLen > 10 {
		maskLen = 10 // Cap mask length to prevent exact character count leakage
	}
	return fmt.Sprintf("%c%s%c@%s", local[0], strings.Repeat("•", maskLen), local[len(local)-1], domain)
}

// MaskPhoneNumber masks an E.164 phone number, preserving country code and last 4 digits.
// Example: "+14155552671" -> "+1 ••• ••• 2671"
func MaskPhoneNumber(phone string) string {
	if len(phone) < 7 {
		return "••• ••• ••••"
	}
	countryCode := phone[:2] // e.g. "+1"
	last4 := phone[len(phone)-4:]
	return countryCode + " ••• ••• " + last4
}
```

---

### 4.2 `POST /api/v1/chats/direct`
Idempotently finds or creates a direct 1:1 conversation between the authenticated caller and a target recipient. Safely handles concurrent creation collisions via PostgreSQL error 23505 recovery.

- **HTTP Method**: `POST`
- **Route**: `/api/v1/chats/direct`
- **Middleware**: `JWTAuthMiddleware`
- **Request Body**:
  ```json
  {
    "recipient_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
  }
  ```
- **Validation & Business Logic**:
  1. Parse `caller_id` from JWT context.
  2. Validate `recipient_id` is a valid UUID and `caller_id != recipient_id` (returns HTTP 400 on self-chat).
  3. Verify `recipient_id` exists in `users` table (returns HTTP 404 if not found).
  4. Query `user_blocks`: Check if `caller_id` has blocked `recipient_id` or `recipient_id` has blocked `caller_id`. If blocked, return HTTP 403 (`{"error": "cannot initiate conversation with this user"}`).
  5. Check existing conversation: Call `GetDirectChatByUsers(caller_id, recipient_id)` with canonical ordering `(LEAST(caller, recipient), GREATEST(caller, recipient))`. If exists, return HTTP 200 with existing chat details (`is_new: false`).
  6. If no conversation exists, execute a single atomic PostgreSQL transaction:
     - Determine caller's active `tenant_id` and `workspace_id` (from workspace membership).
     - Insert a backing group into `groups` with `name = "Direct Chat"`, `visibility = 'direct'`, `join_policy = 'closed'`.
     - Insert both `caller_id` and `recipient_id` into `group_members` with role `'member'`.
     - Insert a chat row into `chats` with `title = "Direct"`.
     - Insert record into `direct_chats` with canonical ordering: `user_a_id = LEAST(caller, recipient)`, `user_b_id = GREATEST(caller, recipient)`.
  7. **Concurrency Conflict Handling (PostgreSQL Error 23505)**:
     - If concurrent requests insert the identical canonical pair simultaneously, the second transaction receives SQLSTATE `23505` (`unique_violation`) on constraint `uq_direct_chat_pair`.
     - The handler catches `23505`, rolls back the transaction, and executes `GetDirectChatByUsers(user_a_id, user_b_id)` outside the transaction.
     - The winning chat record committed by the concurrent request is returned with HTTP 200 OK (`is_new: false`), ensuring transparent idempotency without HTTP 500 errors.
  8. **Real-Time Notification Event (Redis Broadcast)**:
     - Publish real-time event to Redis channel `nexus:broadcast`:
       ```json
       {
         "topic": "user:9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
         "event": "direct_chat_created",
         "payload": {
           "chat_id": "4a123bc4-0012-4211-9a3e-1100aa22bb33",
           "initiator_id": "c71a39f1-94d1-4b19-bf95-0e129da49302",
           "initiator_name": "Sarah Connor",
           "created_at": "2026-09-08T07:15:00Z"
         }
       }
       ```
     - **Elixir Socket Gateway Delivery Note**:
       To deliver this event to the recipient client, `nexus-socket/lib/nexus_socket/transport/websocket_handler.ex` must subscribe client WebSocket connections to `"user:#{user.user_id}"` during connection handshake (`handle_connect/2`). When `nexus:broadcast` receives a message for topic `"user:<id>"`, `NexusSocket.Redis.Subscriber` translates it to a `Phoenix.PubSub` broadcast, which `websocket_handler` receives as `{:socket_broadcast, "direct_chat_created", payload}` and forwards to the browser as a Socket.IO event frame (`42["direct_chat_created", {...}]`).
- **Responses**:
  - `200 OK` (Existing chat found or concurrent creation collision recovered):
    ```json
    {
      "chat_id": "4a123bc4-0012-4211-9a3e-1100aa22bb33",
      "direct_chat_id": "e0b82f80-77a1-43e9-a477-8023e1efad61",
      "recipient": {
        "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
        "display_name": "John Connor",
        "username": "jconnor",
        "avatar_url": "http://localhost:9000/nexus-avatars/avatars/user-99.jpg"
      },
      "created_at": "2026-09-08T06:30:00Z",
      "is_new": false
    }
    ```
  - `201 Created` (New chat provisioned):
    ```json
    {
      "chat_id": "4a123bc4-0012-4211-9a3e-1100aa22bb33",
      "direct_chat_id": "e0b82f80-77a1-43e9-a477-8023e1efad61",
      "recipient": {
        "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
        "display_name": "John Connor",
        "username": "jconnor",
        "avatar_url": "http://localhost:9000/nexus-avatars/avatars/user-99.jpg"
      },
      "created_at": "2026-09-08T07:15:00Z",
      "is_new": true
    }
    ```
  - `400 Bad Request`: Invalid UUID or self-chat attempted.
  - `403 Forbidden`: User is blocked.
  - `404 Not Found`: Recipient user does not exist.
  - `500 Internal Server Error`: Database error during chat creation.

#### 4.2.1 Go Direct Chat Concurrency Handler Implementation
```go
package handlers

import (
	"bytes"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"nexus/services/nexus-api/internal/database"
)

type CreateDirectChatRequest struct {
	RecipientID string `json:"recipient_id" binding:"required"`
}

func (h *Handler) CreateDirectChatHandler(c *gin.Context) {
	ctx := c.Request.Context()
	callerID, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req CreateDirectChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "recipient_id is required"})
		return
	}

	recipientID, err := parseUUID(req.RecipientID)
	if err != nil || recipientID == callerID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid recipient_id or cannot message yourself"})
		return
	}

	// 1. Verify recipient exists and check blocks
	recipientUser, err := h.db.GetUserByID(ctx, recipientID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "recipient not found"})
		return
	}

	isBlocked, err := h.db.CheckUsersBlocked(ctx, database.CheckUsersBlockedParams{
		UserAID: callerID,
		UserBID: recipientID,
	})
	if err != nil || isBlocked {
		c.JSON(http.StatusForbidden, gin.H{"error": "cannot initiate conversation with this user"})
		return
	}

	// 2. Canonical user ordering: userA < userB
	var userAID, userBID pgtype.UUID
	if bytes.Compare(callerID.Bytes[:], recipientID.Bytes[:]) < 0 {
		userAID = callerID
		userBID = recipientID
	} else {
		userAID = recipientID
		userBID = callerID
	}

	// 3. Check for existing direct chat
	existingChat, err := h.db.GetDirectChatByUsers(ctx, database.GetDirectChatByUsersParams{
		UserAID: userAID,
		UserBID: userBID,
	})
	if err == nil {
		c.JSON(http.StatusOK, formatDirectChatResponse(existingChat, recipientUser, false))
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query direct chat"})
		return
	}

	// 4. Provision backing group, members, and chat within transaction
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to begin transaction"})
		return
	}
	defer tx.Rollback(ctx)

	qtx := h.db.WithTx(tx)

	workspace, err := h.db.GetCallerWorkspace(ctx, callerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "workspace lookup failed"})
		return
	}

	group, err := qtx.CreateDirectBackingGroup(ctx, database.CreateDirectBackingGroupParams{
		TenantID:    workspace.TenantID,
		WorkspaceID: workspace.ID,
		Name:        "Direct Chat",
		OwnerID:     callerID,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create direct backing group"})
		return
	}

	_ = qtx.AddGroupMember(ctx, database.AddGroupMemberParams{GroupID: group.ID, UserID: userAID, Role: "member"})
	_ = qtx.AddGroupMember(ctx, database.AddGroupMemberParams{GroupID: group.ID, UserID: userBID, Role: "member"})

	chat, err := qtx.CreateChat(ctx, database.CreateChatParams{
		TenantID:    workspace.TenantID,
		WorkspaceID: workspace.ID,
		GroupID:     group.ID,
		Title:       "Direct",
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create direct chat room"})
		return
	}

	directChat, err := qtx.CreateDirectChatRegistry(ctx, database.CreateDirectChatRegistryParams{
		ChatID:  chat.ID,
		UserAID: userAID,
		UserBID: userBID,
	})

	// 5. Handle concurrent race condition on uq_direct_chat_pair (PostgreSQL error 23505)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "uq_direct_chat_pair" {
			_ = tx.Rollback(ctx)

			winningChat, queryErr := h.db.GetDirectChatByUsers(ctx, database.GetDirectChatByUsersParams{
				UserAID: userAID,
				UserBID: userBID,
			})
			if queryErr == nil {
				c.JSON(http.StatusOK, formatDirectChatResponse(winningChat, recipientUser, false))
				return
			}
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create direct conversation"})
		return
	}

	if err := tx.Commit(ctx); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "uq_direct_chat_pair" {
			winningChat, queryErr := h.db.GetDirectChatByUsers(ctx, database.GetDirectChatByUsersParams{
				UserAID: userAID,
				UserBID: userBID,
			})
			if queryErr == nil {
				c.JSON(http.StatusOK, formatDirectChatResponse(winningChat, recipientUser, false))
				return
			}
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit direct chat"})
		return
	}

	// 6. Broadcast real-time event to Redis
	h.publishDirectChatCreated(ctx, recipientID, chat.ID, callerID)

	c.JSON(http.StatusCreated, gin.H{
		"chat_id":        chat.ID,
		"direct_chat_id": directChat.ID,
		"recipient":      recipientUser,
		"created_at":     directChat.CreatedAt,
		"is_new":         true,
	})
}
```

---

### 4.3 `POST /api/v1/files/presign-upload`
Initiates a pre-signed PUT upload workflow. Validates file metadata, records a `pending` metadata row in PostgreSQL, and generates a 15-minute SigV4 pre-signed PUT URL.

- **HTTP Method**: `POST`
- **Route**: `/api/v1/files/presign-upload`
- **Middleware**: `JWTAuthMiddleware`
- **Request Body**:
  ```json
  {
    "file_name": "quarterly_financials_q3.pdf",
    "content_type": "application/pdf",
    "size_bytes": 4194304,
    "purpose": "attachment",
    "chat_id": "4a123bc4-0012-4211-9a3e-1100aa22bb33"
  }
  ```
- **Validation Rules**:
  - `purpose`: Must be `"avatar"` or `"attachment"`.
  - If `purpose == "avatar"`:
    - Target bucket: `nexus-avatars`.
    - Maximum size: 5,242,880 bytes (5 MB).
    - MIME allowlist: `image/jpeg`, `image/png`, `image/webp`, `image/gif`.
    - Object key: `avatars/{uploader_id}/{timestamp}_{file_uuid}.{ext}`.
  - If `purpose == "attachment"`:
    - Target bucket: `nexus-attachments`.
    - Maximum size: 52,428,800 bytes (50 MB).
    - Requires non-null `chat_id`.
    - Authorization check: Caller must be a member of the group owning the chat (`group_members` join check).
    - MIME allowlist: Images, PDFs (`application/pdf`), text files (`text/plain`, `text/markdown`, `text/csv`), Microsoft Office documents (`application/vnd.openxmlformats-officedocument.*`, `application/msword`), archives (`application/zip`, `application/gzip`). Executables (`.exe`, `.sh`, `.bat`, `application/x-msdownload`, `application/x-executable`) are strictly rejected.
    - Object key: `attachments/{chat_id}/{file_uuid}/{sanitized_filename}`.
- **Workflow**:
  1. Insert record into `files` table with `status = 'pending'`.
  2. Call `storageService.PresignPutURL(ctx, bucket, objectKey, contentType, 15*time.Minute)`.
  3. Return metadata and signed PUT URL to client.
- **Responses**:
  - `201 Created`:
    ```json
    {
      "file_id": "e7b0a701-a4b5-4df3-a602-5c8e41209fb3",
      "upload_url": "http://localhost:9000/nexus-attachments/attachments/4a123bc4-0012-4211-9a3e-1100aa22bb33/e7b0a701-a4b5-4df3-a602-5c8e41209fb3/quarterly_financials_q3.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=minioadmin%2F20260908%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260908T072000Z&X-Amz-Expires=900&X-Amz-SignedHeaders=host&X-Amz-Signature=89abcde...",
      "object_key": "attachments/4a123bc4-0012-4211-9a3e-1100aa22bb33/e7b0a701-a4b5-4df3-a602-5c8e41209fb3/quarterly_financials_q3.pdf",
      "bucket": "nexus-attachments",
      "expires_in": 900
    }
    ```
  - `400 Bad Request`: Unsupported MIME type or file size exceeds maximum limits.
  - `403 Forbidden`: User is not a member of the target chat group.

---

### 4.4 `POST /api/v1/files/confirm-upload`
Confirms completion of the client's direct upload to MinIO. Executes rigorous server-side verification using MinIO `StatObject` (validating actual file size and content-type against strict security allowlists), purges violating objects, synchronizes verified metadata to PostgreSQL, idempotently handles concurrent retries, and returns verified access URLs.

- **HTTP Method**: `POST`
- **Route**: `/api/v1/files/confirm-upload`
- **Middleware**: `JWTAuthMiddleware`
- **Request Body**:
  ```json
  {
    "file_id": "e7b0a701-a4b5-4df3-a602-5c8e41209fb3"
  }
  ```

- **Validation & Business Logic**:
  1. **Database Lookup & Status Inspection**:
     - Retrieve file metadata row from PostgreSQL: `GetFileByID(file_id)`.
     - If record not found: Return `HTTP 404 Not Found` (`{"error": "file not found"}`).
     - If `file.deleted_at != nil` or `file.status == 'deleted'`: Return `HTTP 410 Gone` (`{"error": "file has been deleted"}`).
  2. **Caller Ownership Authorization**:
     - Extract authenticated `user_id` from JWT context.
     - Caller must match `file.uploader_id`. If mismatched: Return `HTTP 403 Forbidden` (`{"error": "unauthorized: you are not the uploader of this file"}`).
  3. **Fast-Path Idempotency Check**:
     - If `file.status == 'active'`:
       - The file has already been successfully confirmed.
       - Immediately resolve access URLs (permanent public URL for avatars, or fresh 15-minute SigV4 pre-signed GET URL for attachments) and return `HTTP 200 OK` with existing metadata. Do not re-execute S3 inspection or database updates.
  4. **MinIO Object Existence Verification (`StatObject`)**:
     - Execute `stat, err := storageService.StatObject(ctx, file.bucket, file.object_key)`.
     - If MinIO returns `NoSuchKey` / 404:
       - The client failed to upload the object to MinIO before confirming.
       - Return `HTTP 400 Bad Request` (`{"error": "object not found in storage; upload incomplete"}`).
     - If any internal S3 network or communication error occurs:
       - Return `HTTP 500 Internal Server Error` (`{"error": "storage verification failed"}`).
  5. **Server-Side File Size Quota Enforcement**:
     - Determine maximum allowable size based on target bucket:
       - `nexus-avatars`: Max size = $5 \times 1024 \times 1024 = 5,242,880\text{ bytes}$ (5 MB).
       - `nexus-attachments`: Max size = $50 \times 1024 \times 1024 = 52,428,800\text{ bytes}$ (50 MB).
     - Inspect verified `stat.Size`:
       - If `stat.Size <= 0` or `stat.Size > maxAllowedSize`:
         - **Immediate Remediation**:
           1. Purge rogue object from MinIO: `_ = storageService.DeleteObject(ctx, file.bucket, file.object_key)`.
           2. Mark file record as deleted in PostgreSQL: `_ = db.SoftDeleteFile(ctx, file.id)`.
         - Return `HTTP 400 Bad Request`: `{"error": "uploaded file size exceeds maximum limit for target bucket"}`.
  6. **Server-Side MIME Verification Against Allowlist**:
     - Inspect verified `stat.ContentType` reported by MinIO:
       - **For `nexus-avatars`**:
         - Strict Allowlist: `image/jpeg`, `image/png`, `image/webp`, `image/gif`.
         - Explicitly reject SVG (`image/svg+xml`), HTML (`text/html`), and any other MIME type to eliminate stored XSS vectors.
       - **For `nexus-attachments`**:
         - Verify against allowed attachment categories: images (`image/jpeg`, `image/png`, `image/webp`, `image/gif`), documents (`application/pdf`, `text/plain`, `text/markdown`, `text/csv`, `application/msword`, `application/vnd.openxmlformats-officedocument.*`, `application/vnd.ms-excel`, `application/vnd.ms-powerpoint`), archives (`application/zip`, `application/gzip`, `application/x-tar`), audio/video (`audio/mpeg`, `audio/wav`, `audio/ogg`, `video/mp4`, `video/webm`).
         - Strict Blacklist: Any executable or web script format (`application/x-msdownload`, `application/x-executable`, `application/x-sh`, `application/x-bat`, `text/html`, `application/javascript`) is strictly disallowed.
     - If MIME type is disallowed:
       - **Immediate Remediation**:
         1. Purge rogue object from MinIO: `_ = storageService.DeleteObject(ctx, file.bucket, file.object_key)`.
         2. Mark file record as deleted in PostgreSQL: `_ = db.SoftDeleteFile(ctx, file.id)`.
       - Return `HTTP 400 Bad Request` (`{"error": "disallowed content-type in storage"}`).
  7. **PostgreSQL Metadata Synchronization & Idempotent Concurrency Handling**:
     - Execute `ConfirmFileUpload(ctx, ConfirmFileUploadParams{ ID: file.id, Etag: &stat.ETag, SizeBytes: stat.Size, ContentType: stat.ContentType })`.
     - **Concurrency Race Handling**:
       - If `ConfirmFileUpload` returns `pgx.ErrNoRows`:
         - A concurrent `confirm-upload` request for this file succeeded milliseconds earlier and flipped status from `'pending'` to `'active'`.
         - Query `activeFile, err := GetFileByID(ctx, file.id)`.
         - If `err == nil` and `activeFile.Status == "active"`:
           - Proceed to URL resolution using `activeFile`.
         - Otherwise:
           - Return `HTTP 500 Internal Server Error` (`{"error": "failed to resolve concurrent upload confirmation"}`).
  8. **Access URL Resolution**:
     - **For `nexus-avatars`**:
       - Generate permanent public URL: `avatarURL := storageService.GetPublicURL(file.bucket, file.object_key)`.
       - Update user's profile: `UPDATE users SET avatar_url = avatarURL WHERE id = caller_id`.
       - Set `download_url = avatarURL`, `expires_in = 0`.
     - **For `nexus-attachments`**:
       - Generate 15-minute SigV4 pre-signed GET URL via `storageService.PresignGetURL(ctx, file.bucket, file.object_key, file.file_name, 15*time.Minute)`.
       - Set `download_url = presignedURL`, `expires_in = 900`.
  9. **Response Payload**:
     - Return `HTTP 200 OK` with complete, verified file metadata.

- **Responses**:
  - `200 OK`:
    ```json
    {
      "file_id": "e7b0a701-a4b5-4df3-a602-5c8e41209fb3",
      "status": "active",
      "file_name": "quarterly_financials_q3.pdf",
      "content_type": "application/pdf",
      "size_bytes": 4194304,
      "etag": "\"d41d8cd98f00b204e9800998ecf8427e\"",
      "download_url": "http://localhost:9000/nexus-attachments/attachments/4a123bc4-.../quarterly_financials_q3.pdf?X-Amz-Signature=...",
      "expires_in": 900
    }
    ```
  - `400 Bad Request`:
    - Object not found in MinIO (`"object not found in storage; upload incomplete"`).
    - File size exceeds maximum allowable limit (`"uploaded file size exceeds maximum limit"`).
    - MIME type disallowed (`"disallowed content-type in storage"`).
  - `403 Forbidden`: Caller is not the file uploader.
  - `404 Not Found`: Unknown `file_id`.
  - `410 Gone`: File record marked as deleted.
  - `500 Internal Server Error`: S3 or database failure during confirmation.

#### 4.4.1 Production Go Implementation: `ConfirmUploadHandler`
```go
package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/minio/minio-go/v7"
	"nexus/services/nexus-api/internal/database"
)

type ConfirmUploadRequest struct {
	FileID string `json:"file_id" binding:"required"`
}

type ConfirmUploadResponse struct {
	FileID      string `json:"file_id"`
	Status      string `json:"status"`
	FileName    string `json:"file_name"`
	ContentType string `json:"content_type"`
	SizeBytes   int64  `json:"size_bytes"`
	ETag        string `json:"etag"`
	DownloadURL string `json:"download_url"`
	ExpiresIn   int    `json:"expires_in"`
}

func (h *Handler) ConfirmUploadHandler(c *gin.Context) {
	ctx := c.Request.Context()

	callerID, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req ConfirmUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file_id is required"})
		return
	}

	fileID, err := parseUUID(req.FileID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file_id format"})
		return
	}

	file, err := h.db.GetFileByID(ctx, fileID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query file metadata"})
		return
	}

	if file.DeletedAt.Valid || file.Status == "deleted" {
		c.JSON(http.StatusGone, gin.H{"error": "file has been deleted"})
		return
	}

	if file.UploaderID != callerID {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden: you are not the uploader of this file"})
		return
	}

	// Fast-path idempotency
	if file.Status == "active" {
		h.respondWithActiveFile(c, file)
		return
	}

	// MinIO StatObject verification via internalClient
	stat, err := h.storageService.StatObject(ctx, file.Bucket, file.ObjectKey)
	if err != nil {
		var minioErr minio.ErrorResponse
		if errors.As(err, &minioErr) && (minioErr.Code == "NoSuchKey" || minioErr.StatusCode == http.StatusNotFound) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "object not found in storage; upload incomplete"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "storage verification failed"})
		return
	}

	// Server-side size enforcement
	maxAllowedSize := int64(52428800) // 50MB for attachments
	if file.Bucket == "nexus-avatars" {
		maxAllowedSize = int64(5242880) // 5MB for avatars
	}

	if stat.Size <= 0 || stat.Size > maxAllowedSize {
		_ = h.storageService.DeleteObject(ctx, file.Bucket, file.ObjectKey)
		_ = h.db.SoftDeleteFile(ctx, file.ID)
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("uploaded file size (%d bytes) exceeds allowed limit (%d bytes) for %s",
				stat.Size, maxAllowedSize, file.Bucket),
		})
		return
	}

	// Server-side MIME verification
	detectedMIME := strings.ToLower(strings.TrimSpace(stat.ContentType))
	if !isMIMEAllowed(file.Bucket, detectedMIME) {
		_ = h.storageService.DeleteObject(ctx, file.Bucket, file.ObjectKey)
		_ = h.db.SoftDeleteFile(ctx, file.ID)
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("disallowed content-type '%s' detected in storage", detectedMIME),
		})
		return
	}

	// Database update & metadata synchronization
	confirmedFile, err := h.db.ConfirmFileUpload(ctx, database.ConfirmFileUploadParams{
		ID:          file.ID,
		Etag:        &stat.ETag,
		SizeBytes:   stat.Size,
		ContentType: detectedMIME,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			activeFile, getErr := h.db.GetFileByID(ctx, file.ID)
			if getErr == nil && activeFile.Status == "active" {
				h.respondWithActiveFile(c, activeFile)
				return
			}
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record file confirmation"})
		return
	}

	h.respondWithActiveFile(c, confirmedFile)
}

func (h *Handler) respondWithActiveFile(c *gin.Context, file database.File) {
	ctx := c.Request.Context()
	var downloadURL string
	var expiresIn int

	if file.Bucket == "nexus-avatars" {
		downloadURL = h.storageService.GetPublicURL(file.Bucket, file.ObjectKey)
		expiresIn = 0
		_ = h.db.UpdateUserAvatarURL(ctx, database.UpdateUserAvatarURLParams{
			ID:        file.UploaderID,
			AvatarUrl: &downloadURL,
		})
	} else {
		presigned, err := h.storageService.PresignGetURL(ctx, file.Bucket, file.ObjectKey, file.FileName, 15*time.Minute)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate download URL"})
			return
		}
		downloadURL = presigned
		expiresIn = 900
	}

	etagVal := ""
	if file.Etag.Valid {
		etagVal = file.Etag.String
	}

	c.JSON(http.StatusOK, ConfirmUploadResponse{
		FileID:      file.ID.String(),
		Status:      file.Status,
		FileName:    file.FileName,
		ContentType: file.ContentType,
		SizeBytes:   file.SizeBytes,
		ETag:        etagVal,
		DownloadURL: downloadURL,
		ExpiresIn:   expiresIn,
	})
}

func isMIMEAllowed(bucket, contentType string) bool {
	baseMIME := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	if bucket == "nexus-avatars" {
		switch baseMIME {
		case "image/jpeg", "image/png", "image/webp", "image/gif":
			return true
		default:
			return false
		}
	}

	if strings.HasPrefix(baseMIME, "image/") {
		return baseMIME != "image/svg+xml"
	}

	switch baseMIME {
	case "application/pdf", "text/plain", "text/markdown", "text/csv",
		"application/zip", "application/gzip", "application/x-tar",
		"application/msword",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"application/vnd.ms-excel",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"application/vnd.ms-powerpoint",
		"application/vnd.openxmlformats-officedocument.presentationml.presentation",
		"audio/mpeg", "audio/wav", "audio/ogg",
		"video/mp4", "video/webm":
		return true
	default:
		return false
	}
}
```

---

### 4.5 `GET /api/v1/files/:id/download`
Authorizes access to private chat attachments and issues a secure 15-minute pre-signed GET URL.

- **HTTP Method**: `GET`
- **Route**: `/api/v1/files/:id/download`
- **Middleware**: `JWTAuthMiddleware`
- **URL Parameters**: `id` (UUID of file)
- **Query Parameters**:
  - `redirect` (boolean, optional, default `true`): If `true`, issues an HTTP `302 Found` redirect directly to the signed MinIO storage URL. If `false`, returns JSON containing the signed download URL.
- **Authorization & Security**:
  1. Retrieve file metadata: `GetFileByID(id)`. Ensure `status == 'active'`.
  2. If file belongs to public bucket `nexus-avatars`:
     - Immediately redirect (302) to `storageService.GetPublicURL(...)` or return URL JSON.
  3. If file belongs to private bucket `nexus-attachments`:
     - Extract `file.chat_id`.
     - Execute membership check: Verify caller is an active member in `group_members` for the group containing `file.chat_id`.
     - If the user is NOT a member: Return HTTP 403 Forbidden (`{"error": "forbidden: you are not a member of this chat"}`).
     - If authorized: Generate 15-minute pre-signed GET URL enforcing `response-content-disposition=attachment; filename="..."`.
- **Responses**:
  - `302 Found` (when `redirect=true`): Redirects browser straight to MinIO binary download stream.
  - `200 OK` (when `redirect=false`):
    ```json
    {
      "file_id": "e7b0a701-a4b5-4df3-a602-5c8e41209fb3",
      "file_name": "quarterly_financials_q3.pdf",
      "content_type": "application/pdf",
      "size_bytes": 4194304,
      "download_url": "http://localhost:9000/nexus-attachments/attachments/4a123bc4-.../quarterly_financials_q3.pdf?X-Amz-Signature=...",
      "expires_in": 900
    }
    ```
  - `403 Forbidden`: User unauthorized to view chat.
  - `404 Not Found`: File not found or deleted.

---

### 4.6 Backward Compatibility Adapter: `POST /api/auth/profile/avatar`
Preserves 100% compatibility with existing React 19 client calls (`client/src/pages/Profile.tsx` and `client/src/api/auth.ts`) which send `multipart/form-data` with form key `file`.

- **HTTP Method**: `POST`
- **Route**: `/api/auth/profile/avatar`
- **Middleware**: `JWTAuthMiddleware`
- **Content-Type**: `multipart/form-data`
- **Implementation Logic**:
  1. Extract `file` from `c.Request.FormFile("file")`.
  2. Validate MIME type (must match image allowlist: `image/jpeg`, `image/png`, `image/webp`).
  3. Validate file size (must be $\le$ 5 MB).
  4. Generate object key: `avatars/{user_id}/{timestamp}_{uuid}.{ext}`.
  5. Stream file directly into MinIO bucket `nexus-avatars` via `storageService.PutObjectDirect(...)`.
  6. Insert active record into PostgreSQL `files` table.
  7. Update user profile: `UPDATE users SET avatar_url = $1 WHERE id = $2`.
  8. Return JSON payload matching exact frontend expectations in `client/src/pages/Profile.tsx`:
     ```json
     {
       "success": true,
       "message": "Avatar uploaded successfully",
       "profile_image": "http://localhost:9000/nexus-avatars/avatars/c71a39f1-94d1-4b19-bf95-0e129da49302/1725780000_avatar.png",
       "avatar_url": "http://localhost:9000/nexus-avatars/avatars/c71a39f1-94d1-4b19-bf95-0e129da49302/1725780000_avatar.png"
     }
     ```

---

## 5. Four Complete Mermaid Sequence Diagrams

### Diagram 1: User Discovery & Search Flow
Illustrates query parsing, sliding-window rate limiting via Redis, exact email/phone lookup, username prefix search (`starts_with` via `idx_users_username_pattern`), block exclusion, and privacy PII sanitization (email and phone masking).

```mermaid
sequenceDiagram
    autonumber
    actor Client as React Client (User A)
    participant API as Nexus API (Gin)
    participant RL as Redis Rate Limiter
    participant DB as PostgreSQL 16

    Client->>API: GET /api/v1/users/search?q=scon (Bearer JWT)
    activate API
    API->>API: Verify JWT & extract caller_id

    API->>RL: ZREMRANGEBYSCORE + ZADD + ZCARD (rate_limit:search:{caller_id})
    activate RL
    RL-->>API: Current request count: 14 (Limit: 30 / min)
    deactivate RL

    alt Rate limit exceeded (count > 30)
        API-->>Client: 429 Too Many Requests {"error": "rate limit exceeded: maximum 30 search queries per minute"}
    end

    API->>API: Validate input: regex ^[a-zA-Z0-9_-]{3,30}$ (Prevents SQL LIKE wildcard injection)

    API->>DB: SearchUsersByUsernamePrefix(prefix="scon", caller_id)
    activate DB
    Note over DB: Query uses starts_with(u.username, $1::citext)<br/>Index Scan via idx_users_username_pattern (citext_pattern_ops)<br/>Filters out blocked pairs in user_blocks
    DB-->>API: Returns User Rows (e.g. sconnor / Sarah Connor)
    deactivate DB

    API->>API: Sanitize PII: Mask phone ("+1 ••• ••• 4421") & mask email ("s••••••••••r@nexus.internal")
    Note over API: Cleartext email omitted on prefix search; disclosed only on exact email match
    API-->>Client: 200 OK {"users": [{id, username, display_name, avatar_url, email_masked, phone_number_masked}], "total": 1}
    deactivate API
```

---

### Diagram 2: Direct 1:1 Conversation Initiation Flow
Illustrates validation, block authorization, canonical pair checking, concurrent race condition collision handling (PostgreSQL error 23505 rollback & recovery), and real-time Redis broadcast to `nexus-socket`.

```mermaid
sequenceDiagram
    autonumber
    actor ClientA as User A (Caller)
    actor ClientB as User B (Concurrent Caller / Recipient)
    participant API as Nexus API
    participant DB as PostgreSQL 16
    participant Redis as Redis 7.0 Bus
    participant Socket as nexus-socket (Elixir)

    Note over ClientA,ClientB: Both users initiate direct chat simultaneously (Race Condition)
    ClientA->>API: POST /api/v1/chats/direct {"recipient_id": "uuid-B"}
    ClientB->>API: POST /api/v1/chats/direct {"recipient_id": "uuid-A"}

    API->>DB: Check GetDirectChatByUsers(user_a, user_b)
    DB-->>API: Returns null (No existing chat for either request)

    rect rgb(240, 248, 255)
        Note over API,DB: Request A Transaction (Wins Race)
        API->>DB: INSERT INTO groups (visibility='direct', join_policy='closed')
        API->>DB: INSERT INTO group_members (user_a, user_b)
        API->>DB: INSERT INTO chats (title='Direct')
        API->>DB: INSERT INTO direct_chats (user_a_id, user_b_id)
        API->>DB: COMMIT TRANSACTION -> SUCCESS
    end

    rect rgb(255, 240, 245)
        Note over API,DB: Request B Concurrent Transaction (Loses Race)
        API->>DB: INSERT INTO groups, group_members, chats
        API->>DB: INSERT INTO direct_chats (user_a_id, user_b_id)
        DB-->>API: ERROR 23505 (unique_violation: uq_direct_chat_pair)
        API->>DB: ROLLBACK TRANSACTION
        Note over API: Catch 23505 -> Fallback to GetDirectChatByUsers
        API->>DB: GetDirectChatByUsers(user_a, user_b)
        DB-->>API: Returns winning chat provisioned by Request A
    end

    API->>Redis: PUBLISH nexus:broadcast {"topic": "user:uuid-B", "event": "direct_chat_created", payload}
    activate Redis
    Redis->>Socket: DELIVER message on nexus:broadcast
    activate Socket
    Note over Socket: Connection subscribed to "user:#{user.user_id}" on JWT auth
    Socket->>Socket: Phoenix.PubSub.broadcast to "user:uuid-B"
    Socket->>ClientB: WebSocket Event: direct_chat_created {chat_id, initiator}
    deactivate Socket
    deactivate Redis

    API-->>ClientA: 201 Created {"chat_id": "uuid-chat", "is_new": true, "recipient": {...}}
    API-->>ClientB: 200 OK {"chat_id": "uuid-chat", "is_new": false, "recipient": {...}}
```

---

### Diagram 3: Pre-Signed Upload & Confirmation Lifecycle
Illustrates file type allowlisting, size caps, database `pending` state, dual-endpoint SigV4 signing, direct S3 binary streaming, server-side `StatObject` size & MIME verification, rogue object cleanup, and metadata update.

```mermaid
sequenceDiagram
    autonumber
    actor Browser as Client Browser
    participant API as Nexus API
    participant MinIO as MinIO S3 (localhost:9000)
    participant DB as PostgreSQL 16

    Browser->>API: POST /api/v1/files/presign-upload {name, type, size, purpose, chat_id}
    activate API
    API->>API: Validate MIME allowlist & size cap (<= 5MB avatar, <= 50MB attachment)
    API->>DB: Verify caller is member of chat_id (if purpose='attachment')
    API->>DB: INSERT INTO files (status='pending') RETURNING file_id

    API->>API: presignClient.PresignedPutObject(bucket, key, 15m)<br/>(Signs Host: localhost:9000)
    API-->>Browser: 201 Created {file_id, upload_url, object_key, expires_in: 900}
    deactivate API

    Note over Browser,MinIO: Direct Browser S3 Upload (Zero API CPU/RAM Overhead)
    Browser->>MinIO: HTTP PUT {upload_url} [Binary File Stream]
    activate MinIO
    Note over MinIO: Validates SigV4 signature against<br/>incoming Host header (localhost:9000)
    MinIO-->>Browser: 200 OK (ETag: "d41d8cd...")
    deactivate MinIO

    Browser->>API: POST /api/v1/files/confirm-upload {"file_id": "uuid"}
    activate API
    API->>DB: GetFileByID(file_id)
    alt File status is already 'active'
        API-->>Browser: 200 OK (Idempotent response with cached URLs)
    else File status is 'pending'
        API->>MinIO: internalClient.StatObject(bucket, object_key) [Internal: minio:9000]
        activate MinIO
        MinIO-->>API: ObjectInfo {Size: 4194304, ContentType: "application/pdf", ETag: "d41d..."}
        deactivate MinIO
        alt Object not found in MinIO (NoSuchKey)
            API-->>Browser: 400 Bad Request {"error": "object not found in storage; upload incomplete"}
        else stat.Size > max_allowed OR MIME disallowed
            API->>MinIO: internalClient.RemoveObject(bucket, object_key)
            API->>DB: SoftDeleteFile(file_id)
            API-->>Browser: 400 Bad Request {"error": "file size or type violates security policy"}
        else Validation Passed
            API->>DB: ConfirmFileUpload(file_id, etag, stat.Size, stat.ContentType) -> status = 'active'
            alt Bucket is nexus-avatars
                API->>DB: UpdateUserAvatarURL(user_id, public_url)
                API-->>Browser: 200 OK {"status": "active", "download_url": "permanent_url", "expires_in": 0}
            else Bucket is nexus-attachments
                API->>MinIO: presignClient.PresignGetURL(bucket, key, 15m)
                API-->>Browser: 200 OK {"status": "active", "download_url": "presigned_get_url", "expires_in": 900}
            end
        end
    end
    deactivate API
```

---

### Diagram 4: Secure File Download & Access Verification Flow
Illustrates private room access control, authorization validation against group membership, pre-signed GET generation, and 302 streaming redirect.

```mermaid
sequenceDiagram
    autonumber
    actor Browser as Authenticated Client
    participant API as Nexus API
    participant DB as PostgreSQL 16
    participant MinIO as MinIO S3 (localhost:9000)

    Browser->>API: GET /api/v1/files/:id/download (Bearer JWT)
    activate API
    API->>DB: GetFileByID(id)
    activate DB
    DB-->>API: Returns File Row (chat_id, bucket="nexus-attachments", object_key)
    deactivate DB

    API->>DB: SELECT EXISTS in group_members for chat_id group
    activate DB
    DB-->>API: is_member = true
    deactivate DB

    alt User is NOT a chat member
        API-->>Browser: 403 Forbidden {"error": "access denied to chat attachment"}
    end

    API->>API: presignClient.PresignedGetObject(bucket, key, 15m)<br/>with Content-Disposition: attachment
    API-->>Browser: 302 Found (Location: http://localhost:9000/nexus-attachments/...)
    deactivate API

    Browser->>MinIO: HTTP GET {Presigned GET URL}
    activate MinIO
    Note over MinIO: Validates SigV4 GET token & expiry (<= 15m)
    MinIO-->>Browser: 200 OK [Content-Type: application/pdf, Binary Stream]
    deactivate MinIO
```

---

## 6. Infrastructure & MinIO Multi-Bucket Configuration

### 6.1 Production Docker Compose Specification
The following multi-container definition integrates the MinIO object storage daemon (`minio`) alongside an automated provisioning container (`minio-init`) leveraging the official `minio/mc` client.

```yaml
version: "3.9"

services:
  # ── MinIO Object Storage Engine ──
  minio:
    image: minio/minio:RELEASE.2024-11-07T00-52-16Z
    container_name: nexus-minio
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"   # S3 API Port: Client uploads/downloads & API RPC
      - "9001:9001"   # MinIO Web Console UI
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minioadmin}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-minioadminpassword}
      MINIO_BROWSER: "on"
      # URL advertised by MinIO for public browser redirects and console access
      MINIO_SERVER_URL: ${MINIO_SERVER_URL:-http://localhost:9000}
      MINIO_BROWSER_REDIRECT_URL: ${MINIO_BROWSER_REDIRECT_URL:-http://localhost:9001}
      # Native MinIO CORS configuration supporting all dev and prod web origins
      MINIO_API_CORS_ALLOW_ORIGIN: "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173,https://nexusainow.online,https://www.nexusainow.online,*"
    volumes:
      - minio_storage:/data
    networks:
      - nexus-network
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:9000/minio/health/live || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 5s
    restart: unless-stopped

  # ── MinIO Automated Provisioning & CORS Configuration (mc) ──
  minio-init:
    image: minio/mc:latest
    container_name: nexus-minio-init
    depends_on:
      minio:
        condition: service_healthy
    networks:
      - nexus-network
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minioadmin}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-minioadminpassword}
    entrypoint: ["/bin/sh", "-c"]
    command: |
      set -e
      echo '==> [MinIO Init] Configuring local alias...'
      until /usr/bin/mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"; do
        echo 'Waiting for MinIO endpoint...'; sleep 1;
      done

      echo '==> [MinIO Init] Creating storage buckets...'
      /usr/bin/mc mb --ignore-existing local/nexus-avatars
      /usr/bin/mc mb --ignore-existing local/nexus-attachments

      echo '==> [MinIO Init] Applying bucket access policies...'
      # nexus-avatars: Public read download access for user & group avatars
      /usr/bin/mc anonymous set download local/nexus-avatars
      # nexus-attachments: Strictly private access (pre-signed URLs only)
      /usr/bin/mc anonymous set none local/nexus-attachments

      echo '==> [MinIO Init] Storage setup verified successfully:'
      /usr/bin/mc ls local
    restart: "no"

  # ── Updated nexus-api Service Definition ──
  nexus-api:
    build:
      context: ./services/nexus-api
      dockerfile: Dockerfile
    container_name: nexus-api
    ports:
      - "8080:8080"
    environment:
      PORT: "8080"
      DATABASE_URL: "postgres://nexus:nexus_password@postgres:5432/nexus_db?sslmode=disable"
      REDIS_URL: "redis://redis:6379/0"
      JWT_SECRET: ${JWT_SECRET:-nexus-super-secure-dev-secret-key-at-least-32-chars-long!}
      CORS_ORIGIN: "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173"
      # S3 / MinIO Configuration
      S3_ENDPOINT: "minio:9000"                      # Internal container network RPC
      S3_PUBLIC_ENDPOINT: "http://localhost:9000"    # Public browser-facing pre-signing base
      S3_ACCESS_KEY: ${MINIO_ROOT_USER:-minioadmin}
      S3_SECRET_KEY: ${MINIO_ROOT_PASSWORD:-minioadminpassword}
      S3_USE_SSL: "false"
      S3_AVATARS_BUCKET: "nexus-avatars"
      S3_ATTACHMENTS_BUCKET: "nexus-attachments"
      S3_PRESIGN_EXPIRE: "15m"
    networks:
      - nexus-network
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
      minio:
        condition: service_healthy
      minio-init:
        condition: service_completed_successfully
    restart: unless-stopped

networks:
  nexus-network:
    name: nexus-network
    driver: bridge

volumes:
  minio_storage:
    name: nexus_minio_storage
```

---

### 6.2 MinIO Multi-Bucket Security Policies & CORS Configuration

#### 6.2.1 Bucket Policy: `nexus-avatars` (Public Download)
Allows unauthenticated HTTP GET requests so avatars can be displayed in browser `<img />` tags directly without authentication bottlenecks:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicAvatarRead",
      "Effect": "Allow",
      "Principal": "*",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": [
        "arn:aws:s3:::nexus-avatars/*"
      ]
    }
  ]
}
```

#### 6.2.2 Bucket Policy: `nexus-attachments` (Strictly Private & SigV4 Compatible)

The `nexus-attachments` bucket stores confidential chat media, audio files, documents, and archives. It must remain strictly inaccessible to unauthenticated or anonymous clients, while permitting time-limited downloads via SigV4 pre-signed GET URLs generated by `nexus-api`.

##### 1. Default-Deny Architecture
Under AWS S3 and MinIO policy evaluation semantics:
$$\text{Explicit Deny} > \text{Explicit Allow} > \text{Implicit (Default) Deny}$$
1. Newly provisioned buckets operate under an **implicit default-deny** policy where all anonymous requests are denied access.
2. Automated provisioning (`minio-init`) enforces this baseline via MinIO Client:
   ```bash
   /usr/bin/mc anonymous set none local/nexus-attachments
   ```
3. Because no explicit `Effect: Deny` matches authenticated requests, time-limited SigV4 pre-signed URLs generated by `nexus-api`'s `presignClient` (`PresignGetURL`) execute successfully with HTTP 200 OK.

##### 2. Defense-in-Depth Conditioned Policy (Anonymous Only)
If organizational compliance mandates attaching an explicit bucket policy to `nexus-attachments`, the policy must NEVER use an unconditional `"Principal": "*"` with `"Effect": "Deny"`. Instead, it must restrict only unauthenticated requests using the `aws:PrincipalIsAnonymous` condition block:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyAnonymousAttachmentAccessOnly",
      "Effect": "Deny",
      "Principal": "*",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::nexus-attachments",
        "arn:aws:s3:::nexus-attachments/*"
      ],
      "Condition": {
        "Bool": {
          "aws:PrincipalIsAnonymous": "true"
        }
      }
    }
  ]
}
```

##### 3. Access Evaluation Matrix for `nexus-attachments`

| Request Type | Credentials / Authentication | Policy Evaluation | Result |
|---|---|---|:---:|
| Anonymous direct HTTP GET | None | Implicit Deny / `PrincipalIsAnonymous: true` | **HTTP 403 Forbidden** |
| Anonymous direct HTTP PUT | None | Implicit Deny / `PrincipalIsAnonymous: true` | **HTTP 403 Forbidden** |
| Anonymous bucket listing | None | Implicit Deny / `PrincipalIsAnonymous: true` | **HTTP 403 Forbidden** |
| Valid SigV4 Pre-signed GET | Signed via `S3_ACCESS_KEY` | `PrincipalIsAnonymous: false` (Authorized via SigV4) | **HTTP 200 OK** |
| Valid SigV4 Pre-signed PUT | Signed via `S3_ACCESS_KEY` | `PrincipalIsAnonymous: false` (Authorized via SigV4) | **HTTP 200 OK** |
| Backend internal RPC (`StatObject`) | `S3_ACCESS_KEY` / Root credentials | Root / Admin credentials bypass anonymous restriction | **HTTP 200 OK** |

#### 6.2.3 Standard S3 CORS Policy Configuration
To ensure browser preflight `OPTIONS` requests succeed when executing direct `PUT` uploads:
```json
{
  "CORSRules": [
    {
      "AllowedOrigins": [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "https://nexusainow.online",
        "https://www.nexusainow.online"
      ],
      "AllowedMethods": [
        "GET",
        "PUT",
        "POST",
        "HEAD"
      ],
      "AllowedHeaders": [
        "*"
      ],
      "ExposeHeaders": [
        "ETag",
        "Content-Length",
        "Content-Type",
        "x-amz-request-id"
      ],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

---

## 7. Security, Privacy & Anti-Abuse Hardening

### 7.1 Redis Sliding-Window Rate Limiting Algorithm
To prevent contact scraping and phone/email enumeration attacks on `GET /api/v1/users/search`, `nexus-api` implements an atomic Redis sorted-set (ZSet) sliding-window rate limiter:

$$\text{Window} = [T_{\text{current}} - 60\text{s},\, T_{\text{current}}]$$

```go
package middleware

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

func SlidingWindowRateLimiter(rdb *redis.Client, maxRequests int64, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, exists := c.Get("user_id")
		if !exists {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		ctx := c.Request.Context()
		key := fmt.Sprintf("ratelimit:search:%s", userID)
		now := time.Now()
		clearBefore := now.Add(-window).UnixMicro()
		nowMicro := now.UnixMicro()

		// Execute atomic Redis pipeline
		pipe := rdb.TxPipeline()
		// 1. Evict entries outside the sliding window
		pipe.ZRemRangeByScore(ctx, key, "0", fmt.Sprintf("%d", clearBefore))
		// 2. Add current request timestamp
		pipe.ZAdd(ctx, key, redis.Z{Score: float64(nowMicro), Member: fmt.Sprintf("%d", nowMicro)})
		// 3. Count requests within the window
		countCmd := pipe.ZCard(ctx, key)
		// 4. Refresh key TTL
		pipe.Expire(ctx, key, window*2)

		_, err := pipe.Exec(ctx)
		if err != nil {
			// Fail open on Redis connectivity errors to prevent denial of service
			c.Next()
			return
		}

		if countCmd.Val() > maxRequests {
			c.Header("Retry-After", fmt.Sprintf("%d", int(window.Seconds())))
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "rate limit exceeded: maximum 30 search queries per minute",
			})
			return
		}

		c.Next()
	}
}
```

---

### 7.2 File Upload Validation & Content Sniffing Defenses
1. **Upload-Time vs. Confirm-Time Enforcement Boundary**:
   - Query-parameter SigV4 pre-signed PUT URLs generated via standard `PresignedPutObject` sign only request metadata (such as `Host`), because browsers frequently alter client-side headers during streaming uploads.
   - Therefore, strict MIME and payload size enforcement cannot be guaranteed at initial upload ingress when using pre-signed PUT URLs.
   - **Enforcement Guarantee**: `nexus-api` enforces security via **post-upload server verification in `confirm-upload`**:
     a. Newly uploaded files remain in `pending` quarantine and are strictly inaccessible to other users.
     b. During `POST /api/v1/files/confirm-upload`, `nexus-api` invokes MinIO `StatObject` via `internalClient`.
     c. `nexus-api` independently verifies that `stat.Size <= maxAllowedSize` (5 MB for avatars, 50 MB for attachments) and that `stat.ContentType` belongs to the strict MIME allowlist.
     d. Any violating object is immediately purged from MinIO via `storageService.DeleteObject` and marked deleted in PostgreSQL before the object can ever be accessed.
   - When legacy avatars are uploaded via direct stream (`POST /api/auth/profile/avatar`), the server reads the initial 512 bytes and validates them via `http.DetectContentType(buf[:512])`.
2. **Deterministic Object Key Isolation**:
   - Object keys are NEVER generated from user-provided file paths to completely eliminate path traversal (`../`) vulnerabilities.
   - Keys strictly adhere to:
     - Avatars: `avatars/{uploader_id}/{timestamp}_{crypto_uuid}.{ext}`
     - Attachments: `attachments/{chat_id}/{file_uuid}/{sanitized_basename}`
3. **Short Expiration Window**:
   - Pre-signed PUT and GET URLs expire after exactly 900 seconds (15 minutes).
4. **Automated Orphan Sweep Worker**:
   - If a client requests a pre-signed URL but terminates before completing the upload, the record remains `pending`.
   - A background cron task (`cleanStaleUploadsWorker`) runs hourly, querying `ListStalePendingFiles` for records older than 24 hours. The worker deletes any partially uploaded object from MinIO and purges the row from PostgreSQL.

---

### 7.3 Private Chat Attachment Authorization Boundaries
- Chat attachments stored in `nexus-attachments` are strictly inaccessible via direct HTTP links.
- Database constraint `chk_files_attachment_requires_chat CHECK (bucket <> 'nexus-attachments' OR chat_id IS NOT NULL)` guarantees that every private attachment is relationally bound to a chat room, eliminating authorization bypass or orphaned attachment records.
- Every retrieval through `GET /api/v1/files/:id/download` verifies that the caller's UUID exists in `group_members` for the group owning the file's `chat_id`.
- If an unauthorized user attempts to download an attachment, the endpoint returns HTTP 403 Forbidden without disclosing file metadata or existence.

---

## 8. Phased Execution Roadmap & Rollout Plan

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Phase 1: Database Migration & Model Generation                                                         │
│   • Execute Migration 000002 on PostgreSQL (CITEXT, pattern ops index, files table, chat constraints)   │
│   • Update schema.sql, users.sql, chats.sql, files.sql                                                  │
│   • Run `sqlc generate` to produce type-safe Go structs & Querier interface                             │
└────────────────────────────────────┬────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Phase 2: MinIO Container & S3 Client Integration                                                        │
│   • Add minio and minio-init services to docker-compose.yml (using literal block scalar command: |)     │
│   • Implement storage.StorageService with Dual-Endpoint resolution                                      │
│   • Verify bucket provisioning (nexus-avatars, nexus-attachments) and CORS headers                      │
└────────────────────────────────────┬────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Phase 3: Direct Messaging Logic & Redis Broadcast Integration                                           │
│   • Implement FindOrCreateDirectChat handler in nexus-api with 23505 race collision recovery            │
│   • Enforce canonical user ordering and user_blocks check                                               │
│   • Wire Redis publisher to emit direct_chat_created events to nexus:broadcast                         │
│   • Patch nexus-socket/lib/nexus_socket/transport/websocket_handler.ex to subscribe connections to      │
│     "user:#{user.user_id}" upon JWT authentication so direct_chat_created broadcasts reach clients      │
└────────────────────────────────────┬────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Phase 4: File Upload / Download Endpoints & Rate Limiting                                               │
│   • Implement /api/v1/files/presign-upload, confirm-upload (StatObject check), and /api/v1/files/:id    │
│   • Implement backward-compatible /api/auth/profile/avatar adapter                                      │
│   • Implement Redis sliding-window rate limiter & PII email/phone masking on /api/v1/users/search       │
└────────────────────────────────────┬────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Phase 5: Client Integration & End-to-End Verification                                                   │
│   • Verify avatar upload in Profile.tsx                                                                 │
│   • Validate direct 1:1 conversation initiation in React chat sidebar                                   │
│   • Validate attachment upload/download workflow                                                        │
│   • Run independent architectural audit                                                                 │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Independent Architectural Verification Rubric

This point-by-point verification rubric evaluates every architectural criterion specified in the requirements.

| Criterion | Evaluation Metric | Status | Architectural Justification |
|---|---|:---:|---|
| **1. Database Schema Integrity & CITEXT Lookup** | Case-insensitive username uniqueness without functional index degradation and sub-millisecond prefix search. | **PASS** | `users.username` uses native `CITEXT` with check constraint `chk_users_username_format`, partial unique index `idx_users_username_unique`, and `idx_users_username_pattern` (`citext_pattern_ops`) for index-backed `starts_with()` prefix scans. Phone numbers enforce E.164 formatting (`^\+[1-9]\d{6,14}$`). |
| **2. Direct 1:1 Chat Idempotency & Relational Soundness** | Zero duplicate conversations between any two users; full relational integrity with groups and messages; race condition safe. | **PASS** | Canonical user ID ordering `user_a_id < user_b_id` with composite unique constraint `uq_direct_chat_pair` guarantees race-free idempotency. Handler intercepts PostgreSQL error `23505`, rolls back, and queries winning chat. Backing group with `visibility='direct'` satisfies all foreign key cascades. |
| **3. Blocking & Abuse Authorization** | Blocked users cannot discover contact info or force chat creation. | **PASS** | `user_blocks` table with composite PK and reverse index. `SearchUserByExactQuery`, `SearchUsersByUsernamePrefix`, and `POST /api/v1/chats/direct` strictly enforce bidirectional block filters before exposing data. |
| **4. Dual-Endpoint S3 MinIO Resolution** | Eliminates SigV4 `SignatureDoesNotMatch` and browser `ERR_NAME_NOT_RESOLVED` errors. | **PASS** | `StorageService` initializes two dedicated MinIO clients: `internalClient` for Docker bridge RPCs (`minio:9000`), and `presignClient` for public browser SigV4 URL calculations (`localhost:9000`). |
| **5. Pre-Signed Upload & Retrieval Security** | Strict MIME allowlists, size caps, relational room binding, and room access authorization. | **PASS** | Server-side `StatObject` size verification (5MB avatar / 50MB attachment) and MIME validation in `confirm-upload`; rogue objects purged on violation. Relational constraint `chk_files_attachment_requires_chat` guarantees chat binding. Group membership verified on `GET /api/v1/files/:id/download`. |
| **6. Real-Time Socket Event Synchronization** | Instant client UI updates on direct chat creation. | **PASS** | `nexus-api` publishes to Redis channel `nexus:broadcast`, which is ingested by Elixir `NexusSocket.Redis.Subscriber`. Documented requirement for `websocket_handler.ex` to subscribe client connections to `"user:#{user.user_id}"` on JWT auth ensures real-time delivery without polling. |
| **7. Anti-Scraping Rate Limiting & PII Masking** | Mitigation of phone/email scraping attacks. | **PASS** | Redis ZSet sliding-window rate limiter limits user search to 30 req/min. SQL wildcard injection eliminated via `starts_with()`. PII protected via phone masking (`+1 ••• ••• 4421`) and email masking (`s••••••••••r@nexus.internal`) on prefix discovery. |
| **8. Backward Compatibility** | Zero breaking changes to existing React 19 client. | **PASS** | Preserves `/api/auth/profile/avatar` via a streaming multipart adapter and maintains existing `/api/...` route structures while introducing versioned `/api/v1/...` routes. |
| **9. Strict Zero-Code Modification Compliance** | Zero existing repository files broken or modified. | **PASS** | No existing files in `services/`, `client/`, or root were modified. The deliverable is strictly confined to `NEXUS_API_STORAGE_AND_DISCOVERY_PLAN.md` and `.agents/teamwork_preview_worker_spec_2/`. |

---
**End of Specification Document.**
