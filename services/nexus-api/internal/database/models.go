package database

import (
	"github.com/jackc/pgx/v5/pgtype"
)

// Tenant represents an organizational boundary.
type Tenant struct {
	ID        pgtype.UUID        `json:"id"`
	Name      string             `json:"name"`
	Plan      string             `json:"plan"`
	Billing   []byte             `json:"billing"`
	CreatedAt pgtype.Timestamptz `json:"created_at"`
}

// User represents a platform user identity with discovery profile extensions.
type User struct {
	ID           pgtype.UUID        `json:"id"`
	Email        string             `json:"email"`
	PasswordHash string             `json:"password_hash,omitempty"`
	DisplayName  string             `json:"display_name"`
	AvatarUrl    string             `json:"avatar_url"`
	SystemRole   string             `json:"system_role"`
	CreatedAt    pgtype.Timestamptz `json:"created_at"`
	LastSeen     pgtype.Timestamptz `json:"last_seen"`
	Username     pgtype.Text        `json:"username"`
	PhoneNumber  pgtype.Text        `json:"phone_number"`
}

// Workspace represents a collaboration tenant space.
type Workspace struct {
	ID        pgtype.UUID        `json:"id"`
	TenantID  pgtype.UUID        `json:"tenant_id"`
	Name      string             `json:"name"`
	Slug      string             `json:"slug"`
	Settings  []byte             `json:"settings"`
	CreatedAt pgtype.Timestamptz `json:"created_at"`
}

// WorkspaceMember represents a user's membership in a workspace.
type WorkspaceMember struct {
	WorkspaceID pgtype.UUID        `json:"workspace_id"`
	UserID      pgtype.UUID        `json:"user_id"`
	Role        string             `json:"role"`
	JoinedAt    pgtype.Timestamptz `json:"joined_at"`
}

// Group represents a collaboration unit (channels or direct conversations).
type Group struct {
	ID             pgtype.UUID        `json:"id"`
	TenantID       pgtype.UUID        `json:"tenant_id"`
	WorkspaceID    pgtype.UUID        `json:"workspace_id"`
	Name           string             `json:"name"`
	OwnerID        pgtype.UUID        `json:"owner_id"`
	AiEnabled      bool               `json:"ai_enabled"`
	InviteCode     pgtype.Text        `json:"invite_code"`
	Handle         pgtype.Text        `json:"handle"`
	Visibility     string             `json:"visibility"`
	JoinPolicy     string             `json:"join_policy"`
	DeletedAt      pgtype.Timestamptz `json:"deleted_at"`
	DeletionReason pgtype.Text        `json:"deletion_reason"`
	CreatedAt      pgtype.Timestamptz `json:"created_at"`
}

// GroupMember represents membership in a group.
type GroupMember struct {
	GroupID  pgtype.UUID        `json:"group_id"`
	UserID   pgtype.UUID        `json:"user_id"`
	Role     string             `json:"role"`
	JoinedAt pgtype.Timestamptz `json:"joined_at"`
}

// GroupInvite represents an invitation link for a group.
type GroupInvite struct {
	Code        string             `json:"code"`
	GroupID     pgtype.UUID        `json:"group_id"`
	CreatedBy   pgtype.UUID        `json:"created_by"`
	RoleGranted string             `json:"role_granted"`
	MaxUses     pgtype.Int4        `json:"max_uses"`
	UseCount    int32              `json:"use_count"`
	ExpiresAt   pgtype.Timestamptz `json:"expires_at"`
	RevokedAt   pgtype.Timestamptz `json:"revoked_at"`
	RevokedBy   pgtype.UUID        `json:"revoked_by"`
	CreatedAt   pgtype.Timestamptz `json:"created_at"`
}

// GroupAuditLog records administrative and member actions within groups.
type GroupAuditLog struct {
	ID        pgtype.UUID        `json:"id"`
	GroupID   pgtype.UUID        `json:"group_id"`
	ActorID   pgtype.UUID        `json:"actor_id"`
	Action    string             `json:"action"`
	Metadata  []byte             `json:"metadata"`
	CreatedAt pgtype.Timestamptz `json:"created_at"`
}

// Chat represents a chat room or channel within a group.
type Chat struct {
	ID          pgtype.UUID        `json:"id"`
	TenantID    pgtype.UUID        `json:"tenant_id"`
	WorkspaceID pgtype.UUID        `json:"workspace_id"`
	GroupID     pgtype.UUID        `json:"group_id"`
	Title       string             `json:"title"`
	CreatedAt   pgtype.Timestamptz `json:"created_at"`
}

// Message represents a chat message.
type Message struct {
	ID                pgtype.UUID        `json:"id"`
	TenantID          pgtype.UUID        `json:"tenant_id"`
	WorkspaceID       pgtype.UUID        `json:"workspace_id"`
	GroupID           pgtype.UUID        `json:"group_id"`
	ChatID            pgtype.UUID        `json:"chat_id"`
	UserID            pgtype.UUID        `json:"user_id"`
	Role              string             `json:"role"`
	Content           string             `json:"content"`
	ReplyTo           []byte             `json:"reply_to"`
	Reactions         []byte             `json:"reactions"`
	ThreadCount       int32              `json:"thread_count"`
	ThreadLastReplyAt pgtype.Timestamptz `json:"thread_last_reply_at"`
	IsDeleted         bool               `json:"is_deleted"`
	IsEdited          bool               `json:"is_edited"`
	CreatedAt         pgtype.Timestamptz `json:"created_at"`
	UpdatedAt         pgtype.Timestamptz `json:"updated_at"`
}

// MessageReaction represents an emoji reaction on a message.
type MessageReaction struct {
	ID        pgtype.UUID        `json:"id"`
	MessageID pgtype.UUID        `json:"message_id"`
	UserID    pgtype.UUID        `json:"user_id"`
	UserEmail string             `json:"user_email"`
	Emoji     string             `json:"emoji"`
	CreatedAt pgtype.Timestamptz `json:"created_at"`
}

// ThreadMessage represents a threaded reply to a message.
type ThreadMessage struct {
	ID              pgtype.UUID        `json:"id"`
	ParentMessageID pgtype.UUID        `json:"parent_message_id"`
	ChatID          pgtype.UUID        `json:"chat_id"`
	GroupID         pgtype.UUID        `json:"group_id"`
	UserID          pgtype.UUID        `json:"user_id"`
	UserEmail       string             `json:"user_email"`
	UserName        pgtype.Text        `json:"user_name"`
	UserAvatar      pgtype.Text        `json:"user_avatar"`
	Content         string             `json:"content"`
	CreatedAt       pgtype.Timestamptz `json:"created_at"`
}

// ReadState tracks per-user per-chat read receipts and unread message counters.
type ReadState struct {
	ID                pgtype.UUID        `json:"id"`
	ChatID            pgtype.UUID        `json:"chat_id"`
	UserID            pgtype.UUID        `json:"user_id"`
	LastReadMessageID pgtype.UUID        `json:"last_read_message_id"`
	LastReadAt        pgtype.Timestamptz `json:"last_read_at"`
	UnreadCount       int32              `json:"unread_count"`
}

// UserBlock represents a unidirectional block relationship.
type UserBlock struct {
	BlockerID pgtype.UUID        `json:"blocker_id"`
	BlockedID pgtype.UUID        `json:"blocked_id"`
	Reason    string             `json:"reason"`
	CreatedAt pgtype.Timestamptz `json:"created_at"`
}

// DirectChat represents the canonical 1:1 conversation mapping between two users.
type DirectChat struct {
	ID        pgtype.UUID        `json:"id"`
	ChatID    pgtype.UUID        `json:"chat_id"`
	UserAID   pgtype.UUID        `json:"user_a_id"`
	UserBID   pgtype.UUID        `json:"user_b_id"`
	CreatedAt pgtype.Timestamptz `json:"created_at"`
}

// File represents MinIO S3 object storage metadata.
type File struct {
	ID          pgtype.UUID        `json:"id"`
	UploaderID  pgtype.UUID        `json:"uploader_id"`
	ChatID      pgtype.UUID        `json:"chat_id"`
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
