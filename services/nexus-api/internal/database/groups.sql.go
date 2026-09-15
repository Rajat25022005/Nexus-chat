package database

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
)

const createGroup = `-- name: CreateGroup :one
INSERT INTO groups (tenant_id, workspace_id, name, owner_id, ai_enabled, invite_code, visibility, join_policy)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, tenant_id, workspace_id, name, owner_id, ai_enabled, invite_code, handle, visibility, join_policy, deleted_at, deletion_reason, created_at
`

type CreateGroupParams struct {
	TenantID    pgtype.UUID `json:"tenant_id"`
	WorkspaceID pgtype.UUID `json:"workspace_id"`
	Name        string      `json:"name"`
	OwnerID     pgtype.UUID `json:"owner_id"`
	AiEnabled   bool        `json:"ai_enabled"`
	InviteCode  pgtype.Text `json:"invite_code"`
	Visibility  string      `json:"visibility"`
	JoinPolicy  string      `json:"join_policy"`
}

func (q *Queries) CreateGroup(ctx context.Context, arg CreateGroupParams) (Group, error) {
	row := q.db.QueryRow(ctx, createGroup,
		arg.TenantID,
		arg.WorkspaceID,
		arg.Name,
		arg.OwnerID,
		arg.AiEnabled,
		arg.InviteCode,
		arg.Visibility,
		arg.JoinPolicy,
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

const createInvite = `-- name: CreateInvite :one
INSERT INTO group_invites (code, group_id, created_by, role_granted, max_uses, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING code, group_id, created_by, role_granted, max_uses, use_count, expires_at, revoked_at, revoked_by, created_at
`

type CreateInviteParams struct {
	Code        string             `json:"code"`
	GroupID     pgtype.UUID        `json:"group_id"`
	CreatedBy   pgtype.UUID        `json:"created_by"`
	RoleGranted string             `json:"role_granted"`
	MaxUses     pgtype.Int4        `json:"max_uses"`
	ExpiresAt   pgtype.Timestamptz `json:"expires_at"`
}

func (q *Queries) CreateInvite(ctx context.Context, arg CreateInviteParams) (GroupInvite, error) {
	row := q.db.QueryRow(ctx, createInvite,
		arg.Code,
		arg.GroupID,
		arg.CreatedBy,
		arg.RoleGranted,
		arg.MaxUses,
		arg.ExpiresAt,
	)
	var i GroupInvite
	err := row.Scan(
		&i.Code,
		&i.GroupID,
		&i.CreatedBy,
		&i.RoleGranted,
		&i.MaxUses,
		&i.UseCount,
		&i.ExpiresAt,
		&i.RevokedAt,
		&i.RevokedBy,
		&i.CreatedAt,
	)
	return i, err
}

const getGroupByInviteCode = `-- name: GetGroupByInviteCode :one
SELECT id, tenant_id, workspace_id, name, owner_id, ai_enabled, invite_code, handle, visibility, join_policy, deleted_at, deletion_reason, created_at FROM groups
WHERE invite_code = $1 AND deleted_at IS NULL
`

func (q *Queries) GetGroupByInviteCode(ctx context.Context, inviteCode pgtype.Text) (Group, error) {
	row := q.db.QueryRow(ctx, getGroupByInviteCode, inviteCode)
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

const getInviteByCode = `-- name: GetInviteByCode :one
SELECT code, group_id, created_by, role_granted, max_uses, use_count, expires_at, revoked_at, revoked_by, created_at FROM group_invites WHERE code = $1 AND revoked_at IS NULL
`

func (q *Queries) GetInviteByCode(ctx context.Context, code string) (GroupInvite, error) {
	row := q.db.QueryRow(ctx, getInviteByCode, code)
	var i GroupInvite
	err := row.Scan(
		&i.Code,
		&i.GroupID,
		&i.CreatedBy,
		&i.RoleGranted,
		&i.MaxUses,
		&i.UseCount,
		&i.ExpiresAt,
		&i.RevokedAt,
		&i.RevokedBy,
		&i.CreatedAt,
	)
	return i, err
}

const incrementInviteUseCount = `-- name: IncrementInviteUseCount :one
UPDATE group_invites
SET use_count = use_count + 1
WHERE code = $1 AND use_count < COALESCE(max_uses, 2147483647)
RETURNING use_count
`

func (q *Queries) IncrementInviteUseCount(ctx context.Context, code string) (int32, error) {
	row := q.db.QueryRow(ctx, incrementInviteUseCount, code)
	var use_count int32
	err := row.Scan(&use_count)
	return use_count, err
}

const insertAuditLog = `-- name: InsertAuditLog :exec
INSERT INTO group_audit_log (group_id, actor_id, action, metadata)
VALUES ($1, $2, $3, $4)
`

type InsertAuditLogParams struct {
	GroupID  pgtype.UUID `json:"group_id"`
	ActorID  pgtype.UUID `json:"actor_id"`
	Action   string      `json:"action"`
	Metadata []byte      `json:"metadata"`
}

func (q *Queries) InsertAuditLog(ctx context.Context, arg InsertAuditLogParams) error {
	_, err := q.db.Exec(ctx, insertAuditLog,
		arg.GroupID,
		arg.ActorID,
		arg.Action,
		arg.Metadata,
	)
	return err
}

const listAuditLog = `-- name: ListAuditLog :many
SELECT id, group_id, actor_id, action, metadata, created_at FROM group_audit_log
WHERE group_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3
`

type ListAuditLogParams struct {
	GroupID pgtype.UUID `json:"group_id"`
	Limit   int32       `json:"limit"`
	Offset  int32       `json:"offset"`
}

func (q *Queries) ListAuditLog(ctx context.Context, arg ListAuditLogParams) ([]GroupAuditLog, error) {
	rows, err := q.db.Query(ctx, listAuditLog, arg.GroupID, arg.Limit, arg.Offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []GroupAuditLog
	for rows.Next() {
		var i GroupAuditLog
		if err := rows.Scan(
			&i.ID,
			&i.GroupID,
			&i.ActorID,
			&i.Action,
			&i.Metadata,
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

const listGroupsByUser = `-- name: ListGroupsByUser :many
SELECT g.id, g.tenant_id, g.workspace_id, g.name, g.owner_id, g.ai_enabled, g.invite_code, g.handle, g.visibility, g.join_policy, g.deleted_at, g.deletion_reason, g.created_at FROM groups g
JOIN group_members gm ON gm.group_id = g.id
WHERE gm.user_id = $1 AND g.deleted_at IS NULL
ORDER BY g.created_at DESC
`

func (q *Queries) ListGroupsByUser(ctx context.Context, userID pgtype.UUID) ([]Group, error) {
	rows, err := q.db.Query(ctx, listGroupsByUser, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []Group
	for rows.Next() {
		var i Group
		if err := rows.Scan(
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

const listInvitesByGroup = `-- name: ListInvitesByGroup :many
SELECT code, group_id, created_by, role_granted, max_uses, use_count, expires_at, revoked_at, revoked_by, created_at FROM group_invites
WHERE group_id = $1 AND revoked_at IS NULL
ORDER BY created_at DESC
`

func (q *Queries) ListInvitesByGroup(ctx context.Context, groupID pgtype.UUID) ([]GroupInvite, error) {
	rows, err := q.db.Query(ctx, listInvitesByGroup, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []GroupInvite
	for rows.Next() {
		var i GroupInvite
		if err := rows.Scan(
			&i.Code,
			&i.GroupID,
			&i.CreatedBy,
			&i.RoleGranted,
			&i.MaxUses,
			&i.UseCount,
			&i.ExpiresAt,
			&i.RevokedAt,
			&i.RevokedBy,
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

const listMessagesByChat = `-- name: ListMessagesByChat :many
SELECT 
  m.id, 
  m.tenant_id, 
  m.workspace_id, 
  m.group_id, 
  m.chat_id, 
  m.user_id, 
  m.role, 
  m.content, 
  m.reply_to, 
  m.is_deleted, 
  m.is_edited, 
  COALESCE(m.thread_count, 0)::int AS thread_count,
  m.thread_last_reply_at,
  m.created_at, 
  m.updated_at, 
  u.email as user_email, 
  u.display_name, 
  u.avatar_url,
  COALESCE(
    (
      SELECT jsonb_object_agg(r.emoji, r.user_emails)
      FROM (
        SELECT emoji, jsonb_agg(user_email) as user_emails
        FROM message_reactions
        WHERE message_id = m.id
        GROUP BY emoji
      ) r
    ),
    '{}'::jsonb
  ) AS reactions
FROM messages m
LEFT JOIN users u ON m.user_id = u.id
WHERE m.chat_id = $1 AND m.is_deleted = false
ORDER BY m.created_at ASC
LIMIT $2 OFFSET $3
`

type ListMessagesByChatParams struct {
	ChatID pgtype.UUID `json:"chat_id"`
	Limit  int32       `json:"limit"`
	Offset int32       `json:"offset"`
}

type ListMessagesByChatRow struct {
	ID                pgtype.UUID        `json:"id"`
	TenantID          pgtype.UUID        `json:"tenant_id"`
	WorkspaceID       pgtype.UUID        `json:"workspace_id"`
	GroupID           pgtype.UUID        `json:"group_id"`
	ChatID            pgtype.UUID        `json:"chat_id"`
	UserID            pgtype.UUID        `json:"user_id"`
	Role              string             `json:"role"`
	Content           string             `json:"content"`
	ReplyTo           []byte             `json:"reply_to"`
	IsDeleted         bool               `json:"is_deleted"`
	IsEdited          bool               `json:"is_edited"`
	ThreadCount       int32              `json:"thread_count"`
	ThreadLastReplyAt pgtype.Timestamptz `json:"thread_last_reply_at"`
	CreatedAt         pgtype.Timestamptz `json:"created_at"`
	UpdatedAt         pgtype.Timestamptz `json:"updated_at"`
	UserEmail         pgtype.Text        `json:"user_email"`
	DisplayName       pgtype.Text        `json:"display_name"`
	AvatarUrl         pgtype.Text        `json:"avatar_url"`
	Reactions         []byte             `json:"reactions"`
}

func (q *Queries) ListMessagesByChat(ctx context.Context, arg ListMessagesByChatParams) ([]ListMessagesByChatRow, error) {
	rows, err := q.db.Query(ctx, listMessagesByChat, arg.ChatID, arg.Limit, arg.Offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []ListMessagesByChatRow
	for rows.Next() {
		var i ListMessagesByChatRow
		if err := rows.Scan(
			&i.ID,
			&i.TenantID,
			&i.WorkspaceID,
			&i.GroupID,
			&i.ChatID,
			&i.UserID,
			&i.Role,
			&i.Content,
			&i.ReplyTo,
			&i.IsDeleted,
			&i.IsEdited,
			&i.ThreadCount,
			&i.ThreadLastReplyAt,
			&i.CreatedAt,
			&i.UpdatedAt,
			&i.UserEmail,
			&i.DisplayName,
			&i.AvatarUrl,
			&i.Reactions,
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

const listThreadMessages = `-- name: ListThreadMessages :many
SELECT 
  tm.id,
  tm.parent_message_id,
  tm.chat_id,
  tm.group_id,
  tm.user_id,
  tm.user_email,
  COALESCE(tm.user_name, u.display_name, '')::text as user_name,
  COALESCE(tm.user_avatar, u.avatar_url, '')::text as user_avatar,
  tm.content,
  tm.created_at
FROM thread_messages tm
LEFT JOIN users u ON tm.user_id = u.id
WHERE tm.parent_message_id = $1
ORDER BY tm.created_at ASC
`

type ListThreadMessagesRow struct {
	ID              pgtype.UUID        `json:"id"`
	ParentMessageID pgtype.UUID        `json:"parent_message_id"`
	ChatID          pgtype.UUID        `json:"chat_id"`
	GroupID         pgtype.UUID        `json:"group_id"`
	UserID          pgtype.UUID        `json:"user_id"`
	UserEmail       string             `json:"user_email"`
	UserName        string             `json:"user_name"`
	UserAvatar      string             `json:"user_avatar"`
	Content         string             `json:"content"`
	CreatedAt       pgtype.Timestamptz `json:"created_at"`
}

func (q *Queries) ListThreadMessages(ctx context.Context, parentMessageID pgtype.UUID) ([]ListThreadMessagesRow, error) {
	rows, err := q.db.Query(ctx, listThreadMessages, parentMessageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []ListThreadMessagesRow
	for rows.Next() {
		var i ListThreadMessagesRow
		if err := rows.Scan(
			&i.ID,
			&i.ParentMessageID,
			&i.ChatID,
			&i.GroupID,
			&i.UserID,
			&i.UserEmail,
			&i.UserName,
			&i.UserAvatar,
			&i.Content,
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

const revokeInvite = `-- name: RevokeInvite :exec
UPDATE group_invites SET revoked_at = NOW(), revoked_by = $2 WHERE code = $1
`

type RevokeInviteParams struct {
	Code      string      `json:"code"`
	RevokedBy pgtype.UUID `json:"revoked_by"`
}

func (q *Queries) RevokeInvite(ctx context.Context, arg RevokeInviteParams) error {
	_, err := q.db.Exec(ctx, revokeInvite, arg.Code, arg.RevokedBy)
	return err
}

const softDeleteGroup = `-- name: SoftDeleteGroup :exec
UPDATE groups SET deleted_at = NOW(), deletion_reason = $2 WHERE id = $1
`

type SoftDeleteGroupParams struct {
	ID             pgtype.UUID `json:"id"`
	DeletionReason pgtype.Text `json:"deletion_reason"`
}

func (q *Queries) SoftDeleteGroup(ctx context.Context, arg SoftDeleteGroupParams) error {
	_, err := q.db.Exec(ctx, softDeleteGroup, arg.ID, arg.DeletionReason)
	return err
}

const updateGroupAI = `-- name: UpdateGroupAI :exec
UPDATE groups SET ai_enabled = $2 WHERE id = $1
`

type UpdateGroupAIParams struct {
	ID        pgtype.UUID `json:"id"`
	AiEnabled bool        `json:"ai_enabled"`
}

func (q *Queries) UpdateGroupAI(ctx context.Context, arg UpdateGroupAIParams) error {
	_, err := q.db.Exec(ctx, updateGroupAI, arg.ID, arg.AiEnabled)
	return err
}
