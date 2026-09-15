package database

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
)

type SearchUserByExactQueryParams struct {
	Query    string      `json:"query"`
	CallerID pgtype.UUID `json:"caller_id"`
}

const searchUserByExactQuery = `-- name: SearchUserByExactQuery :one
SELECT 
    u.id, 
    u.email, 
    u.password_hash,
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
`

func (q *Queries) SearchUserByExactQuery(ctx context.Context, arg SearchUserByExactQueryParams) (User, error) {
	row := q.db.QueryRow(ctx, searchUserByExactQuery, arg.Query, arg.CallerID)
	var i User
	err := row.Scan(
		&i.ID,
		&i.Email,
		&i.PasswordHash,
		&i.DisplayName,
		&i.AvatarUrl,
		&i.Username,
		&i.PhoneNumber,
		&i.SystemRole,
		&i.CreatedAt,
		&i.LastSeen,
	)
	return i, err
}

type SearchUsersByUsernamePrefixParams struct {
	Prefix   string      `json:"prefix"`
	CallerID pgtype.UUID `json:"caller_id"`
	Limit    int32       `json:"limit"`
	Offset   int32       `json:"offset"`
}

const searchUsersByUsernamePrefix = `-- name: SearchUsersByUsernamePrefix :many
SELECT 
    u.id, 
    u.email, 
    u.password_hash,
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
`

func (q *Queries) SearchUsersByUsernamePrefix(ctx context.Context, arg SearchUsersByUsernamePrefixParams) ([]User, error) {
	rows, err := q.db.Query(ctx, searchUsersByUsernamePrefix, arg.Prefix, arg.CallerID, arg.Limit, arg.Offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []User
	for rows.Next() {
		var i User
		if err := rows.Scan(
			&i.ID,
			&i.Email,
			&i.PasswordHash,
			&i.DisplayName,
			&i.AvatarUrl,
			&i.Username,
			&i.PhoneNumber,
			&i.SystemRole,
			&i.CreatedAt,
			&i.LastSeen,
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

const getUserByUsername = `-- name: GetUserByUsername :one
SELECT id, email, password_hash, display_name, avatar_url, username, phone_number, system_role, created_at, last_seen
FROM users
WHERE username = $1::citext
LIMIT 1;
`

func (q *Queries) GetUserByUsername(ctx context.Context, username pgtype.Text) (User, error) {
	row := q.db.QueryRow(ctx, getUserByUsername, username)
	var i User
	err := row.Scan(
		&i.ID,
		&i.Email,
		&i.PasswordHash,
		&i.DisplayName,
		&i.AvatarUrl,
		&i.Username,
		&i.PhoneNumber,
		&i.SystemRole,
		&i.CreatedAt,
		&i.LastSeen,
	)
	return i, err
}

const getUserByPhoneNumber = `-- name: GetUserByPhoneNumber :one
SELECT id, email, password_hash, display_name, avatar_url, username, phone_number, system_role, created_at, last_seen
FROM users
WHERE phone_number = $1
LIMIT 1;
`

func (q *Queries) GetUserByPhoneNumber(ctx context.Context, phoneNumber pgtype.Text) (User, error) {
	row := q.db.QueryRow(ctx, getUserByPhoneNumber, phoneNumber)
	var i User
	err := row.Scan(
		&i.ID,
		&i.Email,
		&i.PasswordHash,
		&i.DisplayName,
		&i.AvatarUrl,
		&i.Username,
		&i.PhoneNumber,
		&i.SystemRole,
		&i.CreatedAt,
		&i.LastSeen,
	)
	return i, err
}

const getUserByID = `-- name: GetUserByID :one
SELECT id, email, password_hash, display_name, avatar_url, username, phone_number, system_role, created_at, last_seen
FROM users
WHERE id = $1;
`

func (q *Queries) GetUserByID(ctx context.Context, id pgtype.UUID) (User, error) {
	row := q.db.QueryRow(ctx, getUserByID, id)
	var i User
	err := row.Scan(
		&i.ID,
		&i.Email,
		&i.PasswordHash,
		&i.DisplayName,
		&i.AvatarUrl,
		&i.Username,
		&i.PhoneNumber,
		&i.SystemRole,
		&i.CreatedAt,
		&i.LastSeen,
	)
	return i, err
}

type UpdateUserDiscoveryProfileParams struct {
	ID          pgtype.UUID `json:"id"`
	Username    pgtype.Text `json:"username"`
	PhoneNumber pgtype.Text `json:"phone_number"`
	DisplayName pgtype.Text `json:"display_name"`
	AvatarUrl   pgtype.Text `json:"avatar_url"`
}

const updateUserDiscoveryProfile = `-- name: UpdateUserDiscoveryProfile :one
UPDATE users
SET 
    username = COALESCE($2, username),
    phone_number = COALESCE($3, phone_number),
    display_name = COALESCE($4, display_name),
    avatar_url = COALESCE($5, avatar_url)
WHERE id = $1
RETURNING id, email, password_hash, display_name, avatar_url, username, phone_number, system_role, created_at, last_seen;
`

func (q *Queries) UpdateUserDiscoveryProfile(ctx context.Context, arg UpdateUserDiscoveryProfileParams) (User, error) {
	row := q.db.QueryRow(ctx, updateUserDiscoveryProfile,
		arg.ID,
		arg.Username,
		arg.PhoneNumber,
		arg.DisplayName,
		arg.AvatarUrl,
	)
	var i User
	err := row.Scan(
		&i.ID,
		&i.Email,
		&i.PasswordHash,
		&i.DisplayName,
		&i.AvatarUrl,
		&i.Username,
		&i.PhoneNumber,
		&i.SystemRole,
		&i.CreatedAt,
		&i.LastSeen,
	)
	return i, err
}

type UpdateUserAvatarURLParams struct {
	ID        pgtype.UUID `json:"id"`
	AvatarUrl string      `json:"avatar_url"`
}

const updateUserAvatarURL = `-- name: UpdateUserAvatarURL :one
UPDATE users
SET avatar_url = $2
WHERE id = $1
RETURNING id, email, password_hash, display_name, avatar_url, username, phone_number, system_role, created_at, last_seen;
`

func (q *Queries) UpdateUserAvatarURL(ctx context.Context, arg UpdateUserAvatarURLParams) (User, error) {
	row := q.db.QueryRow(ctx, updateUserAvatarURL, arg.ID, arg.AvatarUrl)
	var i User
	err := row.Scan(
		&i.ID,
		&i.Email,
		&i.PasswordHash,
		&i.DisplayName,
		&i.AvatarUrl,
		&i.Username,
		&i.PhoneNumber,
		&i.SystemRole,
		&i.CreatedAt,
		&i.LastSeen,
	)
	return i, err
}

type CreateUserParams struct {
	Email        string `json:"email"`
	PasswordHash string `json:"password_hash"`
	DisplayName  string `json:"display_name"`
}

const createUser = `-- name: CreateUser :one
INSERT INTO users (email, password_hash, display_name)
VALUES ($1, $2, $3)
RETURNING id, email, password_hash, display_name, avatar_url, username, phone_number, system_role, created_at, last_seen;
`

func (q *Queries) CreateUser(ctx context.Context, arg CreateUserParams) (User, error) {
	row := q.db.QueryRow(ctx, createUser, arg.Email, arg.PasswordHash, arg.DisplayName)
	var i User
	err := row.Scan(
		&i.ID,
		&i.Email,
		&i.PasswordHash,
		&i.DisplayName,
		&i.AvatarUrl,
		&i.Username,
		&i.PhoneNumber,
		&i.SystemRole,
		&i.CreatedAt,
		&i.LastSeen,
	)
	return i, err
}

const getUserByEmail = `-- name: GetUserByEmail :one
SELECT id, email, password_hash, display_name, avatar_url, username, phone_number, system_role, created_at, last_seen
FROM users
WHERE email = $1;
`

func (q *Queries) GetUserByEmail(ctx context.Context, email string) (User, error) {
	row := q.db.QueryRow(ctx, getUserByEmail, email)
	var i User
	err := row.Scan(
		&i.ID,
		&i.Email,
		&i.PasswordHash,
		&i.DisplayName,
		&i.AvatarUrl,
		&i.Username,
		&i.PhoneNumber,
		&i.SystemRole,
		&i.CreatedAt,
		&i.LastSeen,
	)
	return i, err
}

const updateLastSeen = `-- name: UpdateLastSeen :exec
UPDATE users SET last_seen = NOW() WHERE id = $1;
`

func (q *Queries) UpdateLastSeen(ctx context.Context, id pgtype.UUID) error {
	_, err := q.db.Exec(ctx, updateLastSeen, id)
	return err
}
