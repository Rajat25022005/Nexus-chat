-- ============================================================================
-- Migration: 000001_initial_schema.down.sql
-- Description: Drops base schema in reverse dependency order.
-- ============================================================================

DROP TABLE IF EXISTS read_states;
DROP TABLE IF EXISTS thread_messages;
DROP TABLE IF EXISTS message_reactions;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS chats;
DROP TABLE IF EXISTS group_audit_log;
DROP TABLE IF EXISTS group_invites;
DROP TABLE IF EXISTS group_members;
DROP TABLE IF EXISTS groups;
DROP TABLE IF EXISTS workspace_members;
DROP TABLE IF EXISTS workspaces;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS tenants;
