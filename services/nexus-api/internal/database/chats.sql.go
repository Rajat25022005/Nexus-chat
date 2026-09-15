package database

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
)

type CheckUsersBlockedParams struct {
	UserAID pgtype.UUID `json:"user_a_id"`
	UserBID pgtype.UUID `json:"user_b_id"`
}

const checkUsersBlocked = `-- name: CheckUsersBlocked :one
SELECT EXISTS (
    SELECT 1 FROM user_blocks 
    WHERE (blocker_id = $1 AND blocked_id = $2)
       OR (blocker_id = $2 AND blocked_id = $1)
) AS is_blocked;
`

func (q *Queries) CheckUsersBlocked(ctx context.Context, arg CheckUsersBlockedParams) (bool, error) {
	row := q.db.QueryRow(ctx, checkUsersBlocked, arg.UserAID, arg.UserBID)
	var is_blocked bool
	err := row.Scan(&is_blocked)
	return is_blocked, err
}

type GetDirectChatByUsersParams struct {
	UserAID pgtype.UUID `json:"user_a_id"`
	UserBID pgtype.UUID `json:"user_b_id"`
}

type GetDirectChatByUsersRow struct {
	ID          pgtype.UUID        `json:"id"`
	ChatID      pgtype.UUID        `json:"chat_id"`
	UserAID     pgtype.UUID        `json:"user_a_id"`
	UserBID     pgtype.UUID        `json:"user_b_id"`
	CreatedAt   pgtype.Timestamptz `json:"created_at"`
	TenantID    pgtype.UUID        `json:"tenant_id"`
	WorkspaceID pgtype.UUID        `json:"workspace_id"`
	GroupID     pgtype.UUID        `json:"group_id"`
	Title       string             `json:"title"`
}

const getDirectChatByUsers = `-- name: GetDirectChatByUsers :one
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
`

func (q *Queries) GetDirectChatByUsers(ctx context.Context, arg GetDirectChatByUsersParams) (GetDirectChatByUsersRow, error) {
	row := q.db.QueryRow(ctx, getDirectChatByUsers, arg.UserAID, arg.UserBID)
	var i GetDirectChatByUsersRow
	err := row.Scan(
		&i.ID,
		&i.ChatID,
		&i.UserAID,
		&i.UserBID,
		&i.CreatedAt,
		&i.TenantID,
		&i.WorkspaceID,
		&i.GroupID,
		&i.Title,
	)
	return i, err
}

type CreateDirectChatRegistryParams struct {
	ChatID  pgtype.UUID `json:"chat_id"`
	UserAID pgtype.UUID `json:"user_a_id"`
	UserBID pgtype.UUID `json:"user_b_id"`
}

const createDirectChatRegistry = `-- name: CreateDirectChatRegistry :one
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
`

func (q *Queries) CreateDirectChatRegistry(ctx context.Context, arg CreateDirectChatRegistryParams) (DirectChat, error) {
	row := q.db.QueryRow(ctx, createDirectChatRegistry, arg.ChatID, arg.UserAID, arg.UserBID)
	var i DirectChat
	err := row.Scan(
		&i.ID,
		&i.ChatID,
		&i.UserAID,
		&i.UserBID,
		&i.CreatedAt,
	)
	return i, err
}

type CreateDirectBackingGroupParams struct {
	TenantID    pgtype.UUID `json:"tenant_id"`
	WorkspaceID pgtype.UUID `json:"workspace_id"`
	Name        string      `json:"name"`
	OwnerID     pgtype.UUID `json:"owner_id"`
}

const createDirectBackingGroup = `-- name: CreateDirectBackingGroup :one
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
RETURNING id, tenant_id, workspace_id, name, owner_id, ai_enabled, invite_code, handle, visibility, join_policy, deleted_at, deletion_reason, created_at;
`

func (q *Queries) CreateDirectBackingGroup(ctx context.Context, arg CreateDirectBackingGroupParams) (Group, error) {
	row := q.db.QueryRow(ctx, createDirectBackingGroup,
		arg.TenantID,
		arg.WorkspaceID,
		arg.Name,
		arg.OwnerID,
	)
	var i Group
	err := row.Scan(
		&i.ID,
		&i.TenantID,
		&i.WorkspaceID,
		&i.Name,
		&i.OwnerID,
		&i.AiEnabled,
		&i.InviteCode,
		&i.Handle,
		&i.Visibility,
		&i.JoinPolicy,
		&i.DeletedAt,
		&i.DeletionReason,
		&i.CreatedAt,
	)
	return i, err
}

type AddGroupMemberParams struct {
	GroupID pgtype.UUID `json:"group_id"`
	UserID  pgtype.UUID `json:"user_id"`
	Role    string      `json:"role"`
}

const addGroupMember = `-- name: AddGroupMember :exec
INSERT INTO group_members (
    group_id, 
    user_id, 
    role
) VALUES (
    $1, $2, $3
) ON CONFLICT (group_id, user_id) DO NOTHING;
`

func (q *Queries) AddGroupMember(ctx context.Context, arg AddGroupMemberParams) error {
	_, err := q.db.Exec(ctx, addGroupMember, arg.GroupID, arg.UserID, arg.Role)
	return err
}

type BlockUserParams struct {
	BlockerID pgtype.UUID `json:"blocker_id"`
	BlockedID pgtype.UUID `json:"blocked_id"`
	Reason    string      `json:"reason"`
}

const blockUser = `-- name: BlockUser :exec
INSERT INTO user_blocks (
    blocker_id, 
    blocked_id, 
    reason
) VALUES (
    $1, $2, $3
) ON CONFLICT (blocker_id, blocked_id) DO NOTHING;
`

func (q *Queries) BlockUser(ctx context.Context, arg BlockUserParams) error {
	_, err := q.db.Exec(ctx, blockUser, arg.BlockerID, arg.BlockedID, arg.Reason)
	return err
}

type UnblockUserParams struct {
	BlockerID pgtype.UUID `json:"blocker_id"`
	BlockedID pgtype.UUID `json:"blocked_id"`
}

const unblockUser = `-- name: UnblockUser :exec
DELETE FROM user_blocks 
WHERE blocker_id = $1 AND blocked_id = $2;
`

func (q *Queries) UnblockUser(ctx context.Context, arg UnblockUserParams) error {
	_, err := q.db.Exec(ctx, unblockUser, arg.BlockerID, arg.BlockedID)
	return err
}

type ListBlockedUsersRow struct {
	ID          pgtype.UUID        `json:"id"`
	Email       string             `json:"email"`
	DisplayName string             `json:"display_name"`
	AvatarUrl   string             `json:"avatar_url"`
	Username    pgtype.Text        `json:"username"`
	Reason      string             `json:"reason"`
	BlockedAt   pgtype.Timestamptz `json:"blocked_at"`
}

const listBlockedUsers = `-- name: ListBlockedUsers :many
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
`

func (q *Queries) ListBlockedUsers(ctx context.Context, blockerID pgtype.UUID) ([]ListBlockedUsersRow, error) {
	rows, err := q.db.Query(ctx, listBlockedUsers, blockerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []ListBlockedUsersRow
	for rows.Next() {
		var i ListBlockedUsersRow
		if err := rows.Scan(
			&i.ID,
			&i.Email,
			&i.DisplayName,
			&i.AvatarUrl,
			&i.Username,
			&i.Reason,
			&i.BlockedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

const getCallerWorkspace = `-- name: GetCallerWorkspace :one
SELECT w.id, w.tenant_id, w.name, w.slug, w.settings, w.created_at
FROM workspaces w
JOIN workspace_members wm ON wm.workspace_id = w.id
WHERE wm.user_id = $1
ORDER BY wm.joined_at ASC
LIMIT 1;
`

func (q *Queries) GetCallerWorkspace(ctx context.Context, callerID pgtype.UUID) (Workspace, error) {
	row := q.db.QueryRow(ctx, getCallerWorkspace, callerID)
	var i Workspace
	err := row.Scan(
		&i.ID,
		&i.TenantID,
		&i.Name,
		&i.Slug,
		&i.Settings,
		&i.CreatedAt,
	)
	return i, err
}

type CreateChatParams struct {
	TenantID    pgtype.UUID `json:"tenant_id"`
	WorkspaceID pgtype.UUID `json:"workspace_id"`
	GroupID     pgtype.UUID `json:"group_id"`
	Title       string      `json:"title"`
}

const createChat = `-- name: CreateChat :one
INSERT INTO chats (tenant_id, workspace_id, group_id, title)
VALUES ($1, $2, $3, $4)
RETURNING id, tenant_id, workspace_id, group_id, title, created_at;
`

func (q *Queries) CreateChat(ctx context.Context, arg CreateChatParams) (Chat, error) {
	row := q.db.QueryRow(ctx, createChat,
		arg.TenantID,
		arg.WorkspaceID,
		arg.GroupID,
		arg.Title,
	)
	var i Chat
	err := row.Scan(
		&i.ID,
		&i.TenantID,
		&i.WorkspaceID,
		&i.GroupID,
		&i.Title,
		&i.CreatedAt,
	)
	return i, err
}

const getChatByID = `-- name: GetChatByID :one
SELECT id, tenant_id, workspace_id, group_id, title, created_at
FROM chats
WHERE id = $1;
`

func (q *Queries) GetChatByID(ctx context.Context, id pgtype.UUID) (Chat, error) {
	row := q.db.QueryRow(ctx, getChatByID, id)
	var i Chat
	err := row.Scan(
		&i.ID,
		&i.TenantID,
		&i.WorkspaceID,
		&i.GroupID,
		&i.Title,
		&i.CreatedAt,
	)
	return i, err
}

const listChatsByGroup = `-- name: ListChatsByGroup :many
SELECT id, tenant_id, workspace_id, group_id, title, created_at
FROM chats
WHERE group_id = $1
ORDER BY created_at ASC;
`

func (q *Queries) ListChatsByGroup(ctx context.Context, groupID pgtype.UUID) ([]Chat, error) {
	rows, err := q.db.Query(ctx, listChatsByGroup, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []Chat
	for rows.Next() {
		var i Chat
		if err := rows.Scan(
			&i.ID,
			&i.TenantID,
			&i.WorkspaceID,
			&i.GroupID,
			&i.Title,
			&i.CreatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

const deleteChat = `-- name: DeleteChat :exec
DELETE FROM chats WHERE id = $1;
`

func (q *Queries) DeleteChat(ctx context.Context, id pgtype.UUID) error {
	_, err := q.db.Exec(ctx, deleteChat, id)
	return err
}

const getGroupByID = `-- name: GetGroupByID :one
SELECT id, tenant_id, workspace_id, name, owner_id, ai_enabled, invite_code, handle, visibility, join_policy, deleted_at, deletion_reason, created_at
FROM groups
WHERE id = $1 AND deleted_at IS NULL;
`

func (q *Queries) GetGroupByID(ctx context.Context, id pgtype.UUID) (Group, error) {
	row := q.db.QueryRow(ctx, getGroupByID, id)
	var i Group
	err := row.Scan(
		&i.ID,
		&i.TenantID,
		&i.WorkspaceID,
		&i.Name,
		&i.OwnerID,
		&i.AiEnabled,
		&i.InviteCode,
		&i.Handle,
		&i.Visibility,
		&i.JoinPolicy,
		&i.DeletedAt,
		&i.DeletionReason,
		&i.CreatedAt,
	)
	return i, err
}

type GetGroupMemberParams struct {
	GroupID pgtype.UUID `json:"group_id"`
	UserID  pgtype.UUID `json:"user_id"`
}

const getGroupMember = `-- name: GetGroupMember :one
SELECT group_id, user_id, role, joined_at
FROM group_members
WHERE group_id = $1 AND user_id = $2;
`

func (q *Queries) GetGroupMember(ctx context.Context, arg GetGroupMemberParams) (GroupMember, error) {
	row := q.db.QueryRow(ctx, getGroupMember, arg.GroupID, arg.UserID)
	var i GroupMember
	err := row.Scan(
		&i.GroupID,
		&i.UserID,
		&i.Role,
		&i.JoinedAt,
	)
	return i, err
}

type RemoveGroupMemberParams struct {
	GroupID pgtype.UUID `json:"group_id"`
	UserID  pgtype.UUID `json:"user_id"`
}

const removeGroupMember = `-- name: RemoveGroupMember :exec
DELETE FROM group_members WHERE group_id = $1 AND user_id = $2;
`

func (q *Queries) RemoveGroupMember(ctx context.Context, arg RemoveGroupMemberParams) error {
	_, err := q.db.Exec(ctx, removeGroupMember, arg.GroupID, arg.UserID)
	return err
}

type ListGroupMembersRow struct {
	GroupID     pgtype.UUID        `json:"group_id"`
	UserID      pgtype.UUID        `json:"user_id"`
	Role        string             `json:"role"`
	JoinedAt    pgtype.Timestamptz `json:"joined_at"`
	Email       string             `json:"email"`
	DisplayName string             `json:"display_name"`
	AvatarUrl   string             `json:"avatar_url"`
}

const listGroupMembers = `-- name: ListGroupMembers :many
SELECT gm.group_id, gm.user_id, gm.role, gm.joined_at, u.email, u.display_name, u.avatar_url
FROM group_members gm
JOIN users u ON u.id = gm.user_id
WHERE gm.group_id = $1
ORDER BY gm.joined_at;
`

func (q *Queries) ListGroupMembers(ctx context.Context, groupID pgtype.UUID) ([]ListGroupMembersRow, error) {
	rows, err := q.db.Query(ctx, listGroupMembers, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []ListGroupMembersRow
	for rows.Next() {
		var i ListGroupMembersRow
		if err := rows.Scan(
			&i.GroupID,
			&i.UserID,
			&i.Role,
			&i.JoinedAt,
			&i.Email,
			&i.DisplayName,
			&i.AvatarUrl,
		); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

type CreateOrGetDirectChatAtomicParams struct {
	UserAID  pgtype.UUID `json:"user_a_id"`
	UserBID  pgtype.UUID `json:"user_b_id"`
	CallerID pgtype.UUID `json:"caller_id"`
}

type CreateOrGetDirectChatAtomicRow struct {
	ID          pgtype.UUID        `json:"id"`
	ChatID      pgtype.UUID        `json:"chat_id"`
	UserAID     pgtype.UUID        `json:"user_a_id"`
	UserBID     pgtype.UUID        `json:"user_b_id"`
	CreatedAt   pgtype.Timestamptz `json:"created_at"`
	TenantID    pgtype.UUID        `json:"tenant_id"`
	WorkspaceID pgtype.UUID        `json:"workspace_id"`
	GroupID     pgtype.UUID        `json:"group_id"`
	Title       string             `json:"title"`
	IsNew       bool               `json:"is_new"`
}

const createOrGetDirectChatAtomic = `-- name: CreateOrGetDirectChatAtomic :one
WITH existing AS (
    SELECT 
        dc.id, 
        dc.chat_id, 
        dc.user_a_id, 
        dc.user_b_id, 
        dc.created_at,
        c.tenant_id, 
        c.workspace_id, 
        c.group_id, 
        c.title,
        false AS is_new
    FROM direct_chats dc
    JOIN chats c ON c.id = dc.chat_id
    WHERE dc.user_a_id = LEAST($1::uuid, $2::uuid)
      AND dc.user_b_id = GREATEST($1::uuid, $2::uuid)
    LIMIT 1
),
workspace_lookup AS (
    SELECT w.id AS workspace_id, w.tenant_id
    FROM workspaces w
    JOIN workspace_members wm ON wm.workspace_id = w.id
    WHERE wm.user_id = $3::uuid
      AND NOT EXISTS (SELECT 1 FROM existing)
    ORDER BY wm.joined_at ASC
    LIMIT 1
),
new_group AS (
    INSERT INTO groups (tenant_id, workspace_id, name, owner_id, visibility, join_policy, ai_enabled)
    SELECT wl.tenant_id, wl.workspace_id, 'Direct Chat', $3::uuid, 'direct', 'closed', false
    FROM workspace_lookup wl
    WHERE NOT EXISTS (SELECT 1 FROM existing)
    RETURNING id, tenant_id, workspace_id
),
members AS (
    INSERT INTO group_members (group_id, user_id, role)
    SELECT ng.id, u.user_id, 'member'
    FROM new_group ng, (VALUES ($1::uuid), ($2::uuid)) AS u(user_id)
),
new_chat AS (
    INSERT INTO chats (tenant_id, workspace_id, group_id, title)
    SELECT ng.tenant_id, ng.workspace_id, ng.id, 'Direct'
    FROM new_group ng
    RETURNING id, tenant_id, workspace_id, group_id, title
),
new_direct_chat AS (
    INSERT INTO direct_chats (chat_id, user_a_id, user_b_id)
    SELECT nc.id, LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid)
    FROM new_chat nc
    ON CONFLICT (user_a_id, user_b_id) DO NOTHING
    RETURNING id, chat_id, user_a_id, user_b_id, created_at
)
SELECT 
    coalesce(ndc.id, e.id) AS id,
    coalesce(ndc.chat_id, e.chat_id) AS chat_id,
    coalesce(ndc.user_a_id, e.user_a_id) AS user_a_id,
    coalesce(ndc.user_b_id, e.user_b_id) AS user_b_id,
    coalesce(ndc.created_at, e.created_at) AS created_at,
    coalesce(nc.tenant_id, e.tenant_id) AS tenant_id,
    coalesce(nc.workspace_id, e.workspace_id) AS workspace_id,
    coalesce(nc.group_id, e.group_id) AS group_id,
    coalesce(nc.title, e.title) AS title,
    coalesce(ndc.id IS NOT NULL, false) AS is_new
FROM existing e
FULL OUTER JOIN new_direct_chat ndc ON true
LEFT JOIN new_chat nc ON nc.id = ndc.chat_id
WHERE coalesce(ndc.id, e.id) IS NOT NULL
LIMIT 1;
`

func (q *Queries) CreateOrGetDirectChatAtomic(ctx context.Context, arg CreateOrGetDirectChatAtomicParams) (CreateOrGetDirectChatAtomicRow, error) {
	row := q.db.QueryRow(ctx, createOrGetDirectChatAtomic, arg.UserAID, arg.UserBID, arg.CallerID)
	var i CreateOrGetDirectChatAtomicRow
	err := row.Scan(
		&i.ID,
		&i.ChatID,
		&i.UserAID,
		&i.UserBID,
		&i.CreatedAt,
		&i.TenantID,
		&i.WorkspaceID,
		&i.GroupID,
		&i.Title,
		&i.IsNew,
	)
	return i, err
}
