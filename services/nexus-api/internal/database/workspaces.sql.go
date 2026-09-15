package database

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
)

const addWorkspaceMember = `-- name: AddWorkspaceMember :exec
INSERT INTO workspace_members (workspace_id, user_id, role)
VALUES ($1, $2, $3)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
`

type AddWorkspaceMemberParams struct {
	WorkspaceID pgtype.UUID `json:"workspace_id"`
	UserID      pgtype.UUID `json:"user_id"`
	Role        string      `json:"role"`
}

func (q *Queries) AddWorkspaceMember(ctx context.Context, arg AddWorkspaceMemberParams) error {
	_, err := q.db.Exec(ctx, addWorkspaceMember, arg.WorkspaceID, arg.UserID, arg.Role)
	return err
}

const createTenant = `-- name: CreateTenant :one
INSERT INTO tenants (name, plan)
VALUES ($1, $2)
RETURNING id, name, plan, billing, created_at
`

type CreateTenantParams struct {
	Name string `json:"name"`
	Plan string `json:"plan"`
}

func (q *Queries) CreateTenant(ctx context.Context, arg CreateTenantParams) (Tenant, error) {
	row := q.db.QueryRow(ctx, createTenant, arg.Name, arg.Plan)
	var i Tenant
	err := row.Scan(
		&i.ID,
		&i.Name,
		&i.Plan,
		&i.Billing,
		&i.CreatedAt,
	)
	return i, err
}

const createWorkspace = `-- name: CreateWorkspace :one
INSERT INTO workspaces (tenant_id, name, slug)
VALUES ($1, $2, $3)
RETURNING id, tenant_id, name, slug, settings, created_at
`

type CreateWorkspaceParams struct {
	TenantID pgtype.UUID `json:"tenant_id"`
	Name     string      `json:"name"`
	Slug     string      `json:"slug"`
}

func (q *Queries) CreateWorkspace(ctx context.Context, arg CreateWorkspaceParams) (Workspace, error) {
	row := q.db.QueryRow(ctx, createWorkspace, arg.TenantID, arg.Name, arg.Slug)
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

const getWorkspaceByID = `-- name: GetWorkspaceByID :one
SELECT id, tenant_id, name, slug, settings, created_at FROM workspaces WHERE id = $1
`

func (q *Queries) GetWorkspaceByID(ctx context.Context, id pgtype.UUID) (Workspace, error) {
	row := q.db.QueryRow(ctx, getWorkspaceByID, id)
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

const getWorkspaceBySlug = `-- name: GetWorkspaceBySlug :one
SELECT id, tenant_id, name, slug, settings, created_at FROM workspaces WHERE slug = $1
`

func (q *Queries) GetWorkspaceBySlug(ctx context.Context, slug string) (Workspace, error) {
	row := q.db.QueryRow(ctx, getWorkspaceBySlug, slug)
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

const getWorkspaceMember = `-- name: GetWorkspaceMember :one
SELECT workspace_id, user_id, role, joined_at FROM workspace_members
WHERE workspace_id = $1 AND user_id = $2
`

type GetWorkspaceMemberParams struct {
	WorkspaceID pgtype.UUID `json:"workspace_id"`
	UserID      pgtype.UUID `json:"user_id"`
}

func (q *Queries) GetWorkspaceMember(ctx context.Context, arg GetWorkspaceMemberParams) (WorkspaceMember, error) {
	row := q.db.QueryRow(ctx, getWorkspaceMember, arg.WorkspaceID, arg.UserID)
	var i WorkspaceMember
	err := row.Scan(
		&i.WorkspaceID,
		&i.UserID,
		&i.Role,
		&i.JoinedAt,
	)
	return i, err
}

const listWorkspaceMembers = `-- name: ListWorkspaceMembers :many
SELECT wm.workspace_id, wm.user_id, wm.role, wm.joined_at, u.display_name, u.email, u.avatar_url
FROM workspace_members wm
JOIN users u ON u.id = wm.user_id
WHERE wm.workspace_id = $1
ORDER BY wm.joined_at
`

type ListWorkspaceMembersRow struct {
	WorkspaceID pgtype.UUID        `json:"workspace_id"`
	UserID      pgtype.UUID        `json:"user_id"`
	Role        string             `json:"role"`
	JoinedAt    pgtype.Timestamptz `json:"joined_at"`
	DisplayName string             `json:"display_name"`
	Email       string             `json:"email"`
	AvatarUrl   string             `json:"avatar_url"`
}

func (q *Queries) ListWorkspaceMembers(ctx context.Context, workspaceID pgtype.UUID) ([]ListWorkspaceMembersRow, error) {
	rows, err := q.db.Query(ctx, listWorkspaceMembers, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []ListWorkspaceMembersRow
	for rows.Next() {
		var i ListWorkspaceMembersRow
		if err := rows.Scan(
			&i.WorkspaceID,
			&i.UserID,
			&i.Role,
			&i.JoinedAt,
			&i.DisplayName,
			&i.Email,
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

const listWorkspacesByTenant = `-- name: ListWorkspacesByTenant :many
SELECT w.id, w.tenant_id, w.name, w.slug, w.settings, w.created_at FROM workspaces w
JOIN workspace_members wm ON wm.workspace_id = w.id
WHERE w.tenant_id = $1 AND wm.user_id = $2
ORDER BY w.created_at DESC
`

type ListWorkspacesByTenantParams struct {
	TenantID pgtype.UUID `json:"tenant_id"`
	UserID   pgtype.UUID `json:"user_id"`
}

func (q *Queries) ListWorkspacesByTenant(ctx context.Context, arg ListWorkspacesByTenantParams) ([]Workspace, error) {
	rows, err := q.db.Query(ctx, listWorkspacesByTenant, arg.TenantID, arg.UserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []Workspace
	for rows.Next() {
		var i Workspace
		if err := rows.Scan(
			&i.ID,
			&i.TenantID,
			&i.Name,
			&i.Slug,
			&i.Settings,
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

const listWorkspacesByUser = `-- name: ListWorkspacesByUser :many
SELECT w.id, w.tenant_id, w.name, w.slug, w.settings, w.created_at FROM workspaces w
JOIN workspace_members wm ON wm.workspace_id = w.id
WHERE wm.user_id = $1
ORDER BY w.created_at DESC
`

func (q *Queries) ListWorkspacesByUser(ctx context.Context, userID pgtype.UUID) ([]Workspace, error) {
	rows, err := q.db.Query(ctx, listWorkspacesByUser, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []Workspace
	for rows.Next() {
		var i Workspace
		if err := rows.Scan(
			&i.ID,
			&i.TenantID,
			&i.Name,
			&i.Slug,
			&i.Settings,
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

const removeWorkspaceMember = `-- name: RemoveWorkspaceMember :exec
DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2
`

type RemoveWorkspaceMemberParams struct {
	WorkspaceID pgtype.UUID `json:"workspace_id"`
	UserID      pgtype.UUID `json:"user_id"`
}

func (q *Queries) RemoveWorkspaceMember(ctx context.Context, arg RemoveWorkspaceMemberParams) error {
	_, err := q.db.Exec(ctx, removeWorkspaceMember, arg.WorkspaceID, arg.UserID)
	return err
}
