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
