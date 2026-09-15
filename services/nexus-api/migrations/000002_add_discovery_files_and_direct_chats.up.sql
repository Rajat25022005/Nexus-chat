-- ============================================================================
-- Migration: 000002_add_discovery_files_and_direct_chats.up.sql
-- Description: Extends users table for discovery, adds blocking, direct chats,
--              and MinIO object storage metadata registry.
-- ============================================================================

-- 1. Ensure CITEXT and uuid-ossp extensions are present
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
