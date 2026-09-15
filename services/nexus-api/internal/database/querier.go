package database

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
)

// Querier provides the comprehensive interface for all database query operations.
type Querier interface {
	// User Discovery & Profile Queries
	SearchUserByExactQuery(ctx context.Context, arg SearchUserByExactQueryParams) (User, error)
	SearchUsersByUsernamePrefix(ctx context.Context, arg SearchUsersByUsernamePrefixParams) ([]User, error)
	GetUserByUsername(ctx context.Context, username pgtype.Text) (User, error)
	GetUserByPhoneNumber(ctx context.Context, phoneNumber pgtype.Text) (User, error)
	GetUserByID(ctx context.Context, id pgtype.UUID) (User, error)
	GetUserByEmail(ctx context.Context, email string) (User, error)
	CreateUser(ctx context.Context, arg CreateUserParams) (User, error)
	UpdateUserDiscoveryProfile(ctx context.Context, arg UpdateUserDiscoveryProfileParams) (User, error)
	UpdateUserAvatarURL(ctx context.Context, arg UpdateUserAvatarURLParams) (User, error)
	UpdateLastSeen(ctx context.Context, id pgtype.UUID) error

	// Workspaces & Tenants
	CreateTenant(ctx context.Context, arg CreateTenantParams) (Tenant, error)
	CreateWorkspace(ctx context.Context, arg CreateWorkspaceParams) (Workspace, error)
	GetWorkspaceByID(ctx context.Context, id pgtype.UUID) (Workspace, error)
	GetWorkspaceBySlug(ctx context.Context, slug string) (Workspace, error)
	GetWorkspaceMember(ctx context.Context, arg GetWorkspaceMemberParams) (WorkspaceMember, error)
	ListWorkspaceMembers(ctx context.Context, workspaceID pgtype.UUID) ([]ListWorkspaceMembersRow, error)
	ListWorkspacesByTenant(ctx context.Context, arg ListWorkspacesByTenantParams) ([]Workspace, error)
	ListWorkspacesByUser(ctx context.Context, userID pgtype.UUID) ([]Workspace, error)
	AddWorkspaceMember(ctx context.Context, arg AddWorkspaceMemberParams) error
	RemoveWorkspaceMember(ctx context.Context, arg RemoveWorkspaceMemberParams) error

	// Direct Chat, Group & User Blocking Queries
	CreateOrGetDirectChatAtomic(ctx context.Context, arg CreateOrGetDirectChatAtomicParams) (CreateOrGetDirectChatAtomicRow, error)
	CheckUsersBlocked(ctx context.Context, arg CheckUsersBlockedParams) (bool, error)
	GetDirectChatByUsers(ctx context.Context, arg GetDirectChatByUsersParams) (GetDirectChatByUsersRow, error)
	CreateDirectChatRegistry(ctx context.Context, arg CreateDirectChatRegistryParams) (DirectChat, error)
	CreateDirectBackingGroup(ctx context.Context, arg CreateDirectBackingGroupParams) (Group, error)
	CreateGroup(ctx context.Context, arg CreateGroupParams) (Group, error)
	ListGroupsByUser(ctx context.Context, userID pgtype.UUID) ([]Group, error)
	GetGroupByInviteCode(ctx context.Context, inviteCode pgtype.Text) (Group, error)
	SoftDeleteGroup(ctx context.Context, arg SoftDeleteGroupParams) error
	UpdateGroupAI(ctx context.Context, arg UpdateGroupAIParams) error
	AddGroupMember(ctx context.Context, arg AddGroupMemberParams) error
	RemoveGroupMember(ctx context.Context, arg RemoveGroupMemberParams) error
	GetGroupMember(ctx context.Context, arg GetGroupMemberParams) (GroupMember, error)
	ListGroupMembers(ctx context.Context, groupID pgtype.UUID) ([]ListGroupMembersRow, error)
	GetGroupByID(ctx context.Context, id pgtype.UUID) (Group, error)
	CreateInvite(ctx context.Context, arg CreateInviteParams) (GroupInvite, error)
	GetInviteByCode(ctx context.Context, code string) (GroupInvite, error)
	IncrementInviteUseCount(ctx context.Context, code string) (int32, error)
	RevokeInvite(ctx context.Context, arg RevokeInviteParams) error
	ListInvitesByGroup(ctx context.Context, groupID pgtype.UUID) ([]GroupInvite, error)
	InsertAuditLog(ctx context.Context, arg InsertAuditLogParams) error
	ListAuditLog(ctx context.Context, arg ListAuditLogParams) ([]GroupAuditLog, error)
	BlockUser(ctx context.Context, arg BlockUserParams) error
	UnblockUser(ctx context.Context, arg UnblockUserParams) error
	ListBlockedUsers(ctx context.Context, blockerID pgtype.UUID) ([]ListBlockedUsersRow, error)
	GetCallerWorkspace(ctx context.Context, callerID pgtype.UUID) (Workspace, error)
	CreateChat(ctx context.Context, arg CreateChatParams) (Chat, error)
	GetChatByID(ctx context.Context, id pgtype.UUID) (Chat, error)
	ListChatsByGroup(ctx context.Context, groupID pgtype.UUID) ([]Chat, error)
	DeleteChat(ctx context.Context, id pgtype.UUID) error

	// Message Queries
	ListMessagesByChat(ctx context.Context, arg ListMessagesByChatParams) ([]ListMessagesByChatRow, error)
	ListThreadMessages(ctx context.Context, parentMessageID pgtype.UUID) ([]ListThreadMessagesRow, error)

	// File Storage Metadata Queries
	CreateFileMetadata(ctx context.Context, arg CreateFileMetadataParams) (File, error)
	GetFileByID(ctx context.Context, id pgtype.UUID) (File, error)
	ConfirmFileUpload(ctx context.Context, arg ConfirmFileUploadParams) (File, error)
	SoftDeleteFile(ctx context.Context, id pgtype.UUID) error
	ListFilesByChat(ctx context.Context, arg ListFilesByChatParams) ([]File, error)
	ListStalePendingFiles(ctx context.Context, arg ListStalePendingFilesParams) ([]ListStalePendingFilesRow, error)
}

var _ Querier = (*Queries)(nil)
