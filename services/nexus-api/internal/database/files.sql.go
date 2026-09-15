package database

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
)

type CreateFileMetadataParams struct {
	UploaderID  pgtype.UUID `json:"uploader_id"`
	ChatID      pgtype.UUID `json:"chat_id"`
	Bucket      string      `json:"bucket"`
	ObjectKey   string      `json:"object_key"`
	FileName    string      `json:"file_name"`
	ContentType string      `json:"content_type"`
	SizeBytes   int64       `json:"size_bytes"`
	Metadata    []byte      `json:"metadata"`
}

const createFileMetadata = `-- name: CreateFileMetadata :one
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
`

func (q *Queries) CreateFileMetadata(ctx context.Context, arg CreateFileMetadataParams) (File, error) {
	row := q.db.QueryRow(ctx, createFileMetadata,
		arg.UploaderID,
		arg.ChatID,
		arg.Bucket,
		arg.ObjectKey,
		arg.FileName,
		arg.ContentType,
		arg.SizeBytes,
		arg.Metadata,
	)
	var i File
	err := row.Scan(
		&i.ID,
		&i.UploaderID,
		&i.ChatID,
		&i.Bucket,
		&i.ObjectKey,
		&i.FileName,
		&i.ContentType,
		&i.SizeBytes,
		&i.Status,
		&i.Etag,
		&i.Metadata,
		&i.CreatedAt,
		&i.ConfirmedAt,
		&i.DeletedAt,
	)
	return i, err
}

const getFileByID = `-- name: GetFileByID :one
SELECT 
    id, uploader_id, chat_id, bucket, object_key, 
    file_name, content_type, size_bytes, status, 
    etag, metadata, created_at, confirmed_at, deleted_at
FROM files
WHERE id = $1 AND deleted_at IS NULL;
`

func (q *Queries) GetFileByID(ctx context.Context, id pgtype.UUID) (File, error) {
	row := q.db.QueryRow(ctx, getFileByID, id)
	var i File
	err := row.Scan(
		&i.ID,
		&i.UploaderID,
		&i.ChatID,
		&i.Bucket,
		&i.ObjectKey,
		&i.FileName,
		&i.ContentType,
		&i.SizeBytes,
		&i.Status,
		&i.Etag,
		&i.Metadata,
		&i.CreatedAt,
		&i.ConfirmedAt,
		&i.DeletedAt,
	)
	return i, err
}

type ConfirmFileUploadParams struct {
	ID          pgtype.UUID `json:"id"`
	Etag        pgtype.Text `json:"etag"`
	SizeBytes   int64       `json:"size_bytes"`
	ContentType string      `json:"content_type"`
}

const confirmFileUpload = `-- name: ConfirmFileUpload :one
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
`

func (q *Queries) ConfirmFileUpload(ctx context.Context, arg ConfirmFileUploadParams) (File, error) {
	row := q.db.QueryRow(ctx, confirmFileUpload,
		arg.ID,
		arg.Etag,
		arg.SizeBytes,
		arg.ContentType,
	)
	var i File
	err := row.Scan(
		&i.ID,
		&i.UploaderID,
		&i.ChatID,
		&i.Bucket,
		&i.ObjectKey,
		&i.FileName,
		&i.ContentType,
		&i.SizeBytes,
		&i.Status,
		&i.Etag,
		&i.Metadata,
		&i.CreatedAt,
		&i.ConfirmedAt,
		&i.DeletedAt,
	)
	return i, err
}

const softDeleteFile = `-- name: SoftDeleteFile :exec
UPDATE files
SET 
    status = 'deleted',
    deleted_at = NOW()
WHERE id = $1;
`

func (q *Queries) SoftDeleteFile(ctx context.Context, id pgtype.UUID) error {
	_, err := q.db.Exec(ctx, softDeleteFile, id)
	return err
}

type ListFilesByChatParams struct {
	ChatID pgtype.UUID `json:"chat_id"`
	Limit  int32       `json:"limit"`
	Offset int32       `json:"offset"`
}

const listFilesByChat = `-- name: ListFilesByChat :many
SELECT 
    id, uploader_id, chat_id, bucket, object_key, 
    file_name, content_type, size_bytes, status, 
    etag, metadata, created_at, confirmed_at, deleted_at
FROM files
WHERE chat_id = $1 AND status = 'active'
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;
`

func (q *Queries) ListFilesByChat(ctx context.Context, arg ListFilesByChatParams) ([]File, error) {
	rows, err := q.db.Query(ctx, listFilesByChat, arg.ChatID, arg.Limit, arg.Offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []File
	for rows.Next() {
		var i File
		if err := rows.Scan(
			&i.ID,
			&i.UploaderID,
			&i.ChatID,
			&i.Bucket,
			&i.ObjectKey,
			&i.FileName,
			&i.ContentType,
			&i.SizeBytes,
			&i.Status,
			&i.Etag,
			&i.Metadata,
			&i.CreatedAt,
			&i.ConfirmedAt,
			&i.DeletedAt,
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

type ListStalePendingFilesParams struct {
	CreatedAt pgtype.Timestamptz `json:"created_at"`
	Limit     int32              `json:"limit"`
}

type ListStalePendingFilesRow struct {
	ID        pgtype.UUID        `json:"id"`
	Bucket    string             `json:"bucket"`
	ObjectKey string             `json:"object_key"`
	CreatedAt pgtype.Timestamptz `json:"created_at"`
}

const listStalePendingFiles = `-- name: ListStalePendingFiles :many
SELECT id, bucket, object_key, created_at
FROM files
WHERE status = 'pending'
  AND created_at < $1
LIMIT $2;
`

func (q *Queries) ListStalePendingFiles(ctx context.Context, arg ListStalePendingFilesParams) ([]ListStalePendingFilesRow, error) {
	rows, err := q.db.Query(ctx, listStalePendingFiles, arg.CreatedAt, arg.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []ListStalePendingFilesRow
	for rows.Next() {
		var i ListStalePendingFilesRow
		if err := rows.Scan(
			&i.ID,
			&i.Bucket,
			&i.ObjectKey,
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
