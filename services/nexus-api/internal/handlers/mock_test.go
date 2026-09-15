package handlers

import (
	"context"
	"io"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/minio/minio-go/v7"
	"github.com/redis/go-redis/v9"

	"nexus/nexus-api/internal/database"
	"nexus/nexus-api/internal/services"
	"nexus/nexus-api/internal/storage"
)

type MockQuerier struct {
	SearchUserByExactQueryFn      func(ctx context.Context, arg database.SearchUserByExactQueryParams) (database.User, error)
	SearchUsersByUsernamePrefixFn func(ctx context.Context, arg database.SearchUsersByUsernamePrefixParams) ([]database.User, error)
	GetUserByUsernameFn           func(ctx context.Context, username pgtype.Text) (database.User, error)
	GetUserByPhoneNumberFn        func(ctx context.Context, phoneNumber pgtype.Text) (database.User, error)
	GetUserByIDFn                 func(ctx context.Context, id pgtype.UUID) (database.User, error)
	GetUserByEmailFn              func(ctx context.Context, email string) (database.User, error)
	CreateUserFn                  func(ctx context.Context, arg database.CreateUserParams) (database.User, error)
	UpdateUserDiscoveryProfileFn  func(ctx context.Context, arg database.UpdateUserDiscoveryProfileParams) (database.User, error)
	UpdateUserAvatarURLFn         func(ctx context.Context, arg database.UpdateUserAvatarURLParams) (database.User, error)
	UpdateLastSeenFn              func(ctx context.Context, id pgtype.UUID) error

	CreateTenantFn          func(ctx context.Context, arg database.CreateTenantParams) (database.Tenant, error)
	CreateWorkspaceFn       func(ctx context.Context, arg database.CreateWorkspaceParams) (database.Workspace, error)
	GetWorkspaceByIDFn      func(ctx context.Context, id pgtype.UUID) (database.Workspace, error)
	GetWorkspaceBySlugFn    func(ctx context.Context, slug string) (database.Workspace, error)
	GetWorkspaceMemberFn    func(ctx context.Context, arg database.GetWorkspaceMemberParams) (database.WorkspaceMember, error)
	ListWorkspaceMembersFn  func(ctx context.Context, workspaceID pgtype.UUID) ([]database.ListWorkspaceMembersRow, error)
	ListWorkspacesByTenantFn func(ctx context.Context, arg database.ListWorkspacesByTenantParams) ([]database.Workspace, error)
	ListWorkspacesByUserFn  func(ctx context.Context, userID pgtype.UUID) ([]database.Workspace, error)
	AddWorkspaceMemberFn    func(ctx context.Context, arg database.AddWorkspaceMemberParams) error
	RemoveWorkspaceMemberFn func(ctx context.Context, arg database.RemoveWorkspaceMemberParams) error

	CreateOrGetDirectChatAtomicFn func(ctx context.Context, arg database.CreateOrGetDirectChatAtomicParams) (database.CreateOrGetDirectChatAtomicRow, error)
	CheckUsersBlockedFn        func(ctx context.Context, arg database.CheckUsersBlockedParams) (bool, error)
	GetDirectChatByUsersFn     func(ctx context.Context, arg database.GetDirectChatByUsersParams) (database.GetDirectChatByUsersRow, error)
	CreateDirectChatRegistryFn func(ctx context.Context, arg database.CreateDirectChatRegistryParams) (database.DirectChat, error)
	CreateDirectBackingGroupFn func(ctx context.Context, arg database.CreateDirectBackingGroupParams) (database.Group, error)
	CreateGroupFn              func(ctx context.Context, arg database.CreateGroupParams) (database.Group, error)
	ListGroupsByUserFn         func(ctx context.Context, userID pgtype.UUID) ([]database.Group, error)
	GetGroupByInviteCodeFn     func(ctx context.Context, inviteCode pgtype.Text) (database.Group, error)
	SoftDeleteGroupFn          func(ctx context.Context, arg database.SoftDeleteGroupParams) error
	UpdateGroupAIFn            func(ctx context.Context, arg database.UpdateGroupAIParams) error
	AddGroupMemberFn           func(ctx context.Context, arg database.AddGroupMemberParams) error
	RemoveGroupMemberFn        func(ctx context.Context, arg database.RemoveGroupMemberParams) error
	GetGroupMemberFn           func(ctx context.Context, arg database.GetGroupMemberParams) (database.GroupMember, error)
	ListGroupMembersFn         func(ctx context.Context, groupID pgtype.UUID) ([]database.ListGroupMembersRow, error)
	GetGroupByIDFn             func(ctx context.Context, id pgtype.UUID) (database.Group, error)
	CreateInviteFn             func(ctx context.Context, arg database.CreateInviteParams) (database.GroupInvite, error)
	GetInviteByCodeFn          func(ctx context.Context, code string) (database.GroupInvite, error)
	IncrementInviteUseCountFn  func(ctx context.Context, code string) (int32, error)
	RevokeInviteFn             func(ctx context.Context, arg database.RevokeInviteParams) error
	ListInvitesByGroupFn       func(ctx context.Context, groupID pgtype.UUID) ([]database.GroupInvite, error)
	InsertAuditLogFn           func(ctx context.Context, arg database.InsertAuditLogParams) error
	ListAuditLogFn             func(ctx context.Context, arg database.ListAuditLogParams) ([]database.GroupAuditLog, error)
	BlockUserFn                func(ctx context.Context, arg database.BlockUserParams) error
	UnblockUserFn              func(ctx context.Context, arg database.UnblockUserParams) error
	ListBlockedUsersFn         func(ctx context.Context, blockerID pgtype.UUID) ([]database.ListBlockedUsersRow, error)
	GetCallerWorkspaceFn       func(ctx context.Context, callerID pgtype.UUID) (database.Workspace, error)
	CreateChatFn               func(ctx context.Context, arg database.CreateChatParams) (database.Chat, error)
	GetChatByIDFn              func(ctx context.Context, id pgtype.UUID) (database.Chat, error)
	ListChatsByGroupFn         func(ctx context.Context, groupID pgtype.UUID) ([]database.Chat, error)
	DeleteChatFn               func(ctx context.Context, id pgtype.UUID) error

	ListMessagesByChatFn func(ctx context.Context, arg database.ListMessagesByChatParams) ([]database.ListMessagesByChatRow, error)
	ListThreadMessagesFn func(ctx context.Context, parentMessageID pgtype.UUID) ([]database.ListThreadMessagesRow, error)

	CreateFileMetadataFn    func(ctx context.Context, arg database.CreateFileMetadataParams) (database.File, error)
	GetFileByIDFn           func(ctx context.Context, id pgtype.UUID) (database.File, error)
	ConfirmFileUploadFn     func(ctx context.Context, arg database.ConfirmFileUploadParams) (database.File, error)
	SoftDeleteFileFn        func(ctx context.Context, id pgtype.UUID) error
	ListFilesByChatFn       func(ctx context.Context, arg database.ListFilesByChatParams) ([]database.File, error)
	ListStalePendingFilesFn func(ctx context.Context, arg database.ListStalePendingFilesParams) ([]database.ListStalePendingFilesRow, error)
}

var _ database.Querier = (*MockQuerier)(nil)

func (m *MockQuerier) SearchUserByExactQuery(ctx context.Context, arg database.SearchUserByExactQueryParams) (database.User, error) {
	if m.SearchUserByExactQueryFn != nil {
		return m.SearchUserByExactQueryFn(ctx, arg)
	}
	return database.User{}, nil
}

func (m *MockQuerier) SearchUsersByUsernamePrefix(ctx context.Context, arg database.SearchUsersByUsernamePrefixParams) ([]database.User, error) {
	if m.SearchUsersByUsernamePrefixFn != nil {
		return m.SearchUsersByUsernamePrefixFn(ctx, arg)
	}
	return nil, nil
}

func (m *MockQuerier) GetUserByUsername(ctx context.Context, username pgtype.Text) (database.User, error) {
	if m.GetUserByUsernameFn != nil {
		return m.GetUserByUsernameFn(ctx, username)
	}
	return database.User{}, nil
}

func (m *MockQuerier) GetUserByPhoneNumber(ctx context.Context, phoneNumber pgtype.Text) (database.User, error) {
	if m.GetUserByPhoneNumberFn != nil {
		return m.GetUserByPhoneNumberFn(ctx, phoneNumber)
	}
	return database.User{}, nil
}

func (m *MockQuerier) GetUserByID(ctx context.Context, id pgtype.UUID) (database.User, error) {
	if m.GetUserByIDFn != nil {
		return m.GetUserByIDFn(ctx, id)
	}
	return database.User{}, nil
}

func (m *MockQuerier) GetUserByEmail(ctx context.Context, email string) (database.User, error) {
	if m.GetUserByEmailFn != nil {
		return m.GetUserByEmailFn(ctx, email)
	}
	return database.User{}, nil
}

func (m *MockQuerier) CreateUser(ctx context.Context, arg database.CreateUserParams) (database.User, error) {
	if m.CreateUserFn != nil {
		return m.CreateUserFn(ctx, arg)
	}
	return database.User{}, nil
}

func (m *MockQuerier) UpdateUserDiscoveryProfile(ctx context.Context, arg database.UpdateUserDiscoveryProfileParams) (database.User, error) {
	if m.UpdateUserDiscoveryProfileFn != nil {
		return m.UpdateUserDiscoveryProfileFn(ctx, arg)
	}
	return database.User{}, nil
}

func (m *MockQuerier) UpdateUserAvatarURL(ctx context.Context, arg database.UpdateUserAvatarURLParams) (database.User, error) {
	if m.UpdateUserAvatarURLFn != nil {
		return m.UpdateUserAvatarURLFn(ctx, arg)
	}
	return database.User{}, nil
}

func (m *MockQuerier) UpdateLastSeen(ctx context.Context, id pgtype.UUID) error {
	if m.UpdateLastSeenFn != nil {
		return m.UpdateLastSeenFn(ctx, id)
	}
	return nil
}

func (m *MockQuerier) CreateTenant(ctx context.Context, arg database.CreateTenantParams) (database.Tenant, error) {
	if m.CreateTenantFn != nil {
		return m.CreateTenantFn(ctx, arg)
	}
	return database.Tenant{}, nil
}

func (m *MockQuerier) CreateWorkspace(ctx context.Context, arg database.CreateWorkspaceParams) (database.Workspace, error) {
	if m.CreateWorkspaceFn != nil {
		return m.CreateWorkspaceFn(ctx, arg)
	}
	return database.Workspace{}, nil
}

func (m *MockQuerier) GetWorkspaceByID(ctx context.Context, id pgtype.UUID) (database.Workspace, error) {
	if m.GetWorkspaceByIDFn != nil {
		return m.GetWorkspaceByIDFn(ctx, id)
	}
	return database.Workspace{}, nil
}

func (m *MockQuerier) GetWorkspaceBySlug(ctx context.Context, slug string) (database.Workspace, error) {
	if m.GetWorkspaceBySlugFn != nil {
		return m.GetWorkspaceBySlugFn(ctx, slug)
	}
	return database.Workspace{}, nil
}

func (m *MockQuerier) GetWorkspaceMember(ctx context.Context, arg database.GetWorkspaceMemberParams) (database.WorkspaceMember, error) {
	if m.GetWorkspaceMemberFn != nil {
		return m.GetWorkspaceMemberFn(ctx, arg)
	}
	return database.WorkspaceMember{}, nil
}

func (m *MockQuerier) ListWorkspaceMembers(ctx context.Context, workspaceID pgtype.UUID) ([]database.ListWorkspaceMembersRow, error) {
	if m.ListWorkspaceMembersFn != nil {
		return m.ListWorkspaceMembersFn(ctx, workspaceID)
	}
	return nil, nil
}

func (m *MockQuerier) ListWorkspacesByTenant(ctx context.Context, arg database.ListWorkspacesByTenantParams) ([]database.Workspace, error) {
	if m.ListWorkspacesByTenantFn != nil {
		return m.ListWorkspacesByTenantFn(ctx, arg)
	}
	return nil, nil
}

func (m *MockQuerier) ListWorkspacesByUser(ctx context.Context, userID pgtype.UUID) ([]database.Workspace, error) {
	if m.ListWorkspacesByUserFn != nil {
		return m.ListWorkspacesByUserFn(ctx, userID)
	}
	return nil, nil
}

func (m *MockQuerier) AddWorkspaceMember(ctx context.Context, arg database.AddWorkspaceMemberParams) error {
	if m.AddWorkspaceMemberFn != nil {
		return m.AddWorkspaceMemberFn(ctx, arg)
	}
	return nil
}

func (m *MockQuerier) RemoveWorkspaceMember(ctx context.Context, arg database.RemoveWorkspaceMemberParams) error {
	if m.RemoveWorkspaceMemberFn != nil {
		return m.RemoveWorkspaceMemberFn(ctx, arg)
	}
	return nil
}

func (m *MockQuerier) CreateOrGetDirectChatAtomic(ctx context.Context, arg database.CreateOrGetDirectChatAtomicParams) (database.CreateOrGetDirectChatAtomicRow, error) {
	if m.CreateOrGetDirectChatAtomicFn != nil {
		return m.CreateOrGetDirectChatAtomicFn(ctx, arg)
	}
	if m.GetDirectChatByUsersFn != nil {
		row, err := m.GetDirectChatByUsersFn(ctx, database.GetDirectChatByUsersParams{
			UserAID: arg.UserAID,
			UserBID: arg.UserBID,
		})
		if err == nil {
			return database.CreateOrGetDirectChatAtomicRow{
				ID:        row.ID,
				ChatID:    row.ChatID,
				UserAID:   row.UserAID,
				UserBID:   row.UserBID,
				CreatedAt: row.CreatedAt,
				IsNew:     false,
			}, nil
		}
	}
	if m.CreateDirectChatRegistryFn != nil {
		dc, err := m.CreateDirectChatRegistryFn(ctx, database.CreateDirectChatRegistryParams{
			UserAID: arg.UserAID,
			UserBID: arg.UserBID,
		})
		if err != nil {
			if m.GetDirectChatByUsersFn != nil {
				row, qErr := m.GetDirectChatByUsersFn(ctx, database.GetDirectChatByUsersParams{
					UserAID: arg.UserAID,
					UserBID: arg.UserBID,
				})
				if qErr == nil {
					return database.CreateOrGetDirectChatAtomicRow{
						ID:        row.ID,
						ChatID:    row.ChatID,
						UserAID:   row.UserAID,
						UserBID:   row.UserBID,
						CreatedAt: row.CreatedAt,
						IsNew:     false,
					}, nil
				}
			}
			return database.CreateOrGetDirectChatAtomicRow{}, err
		}
		chatID := dc.ChatID
		if m.CreateChatFn != nil {
			ch, _ := m.CreateChatFn(ctx, database.CreateChatParams{})
			if ch.ID.Valid {
				chatID = ch.ID
			}
		}
		return database.CreateOrGetDirectChatAtomicRow{
			ID:        dc.ID,
			ChatID:    chatID,
			UserAID:   dc.UserAID,
			UserBID:   dc.UserBID,
			CreatedAt: dc.CreatedAt,
			IsNew:     true,
		}, nil
	}
	return database.CreateOrGetDirectChatAtomicRow{
		IsNew: true,
	}, nil
}

func (m *MockQuerier) CheckUsersBlocked(ctx context.Context, arg database.CheckUsersBlockedParams) (bool, error) {
	if m.CheckUsersBlockedFn != nil {
		return m.CheckUsersBlockedFn(ctx, arg)
	}
	return false, nil
}

func (m *MockQuerier) GetDirectChatByUsers(ctx context.Context, arg database.GetDirectChatByUsersParams) (database.GetDirectChatByUsersRow, error) {
	if m.GetDirectChatByUsersFn != nil {
		return m.GetDirectChatByUsersFn(ctx, arg)
	}
	return database.GetDirectChatByUsersRow{}, nil
}

func (m *MockQuerier) CreateDirectChatRegistry(ctx context.Context, arg database.CreateDirectChatRegistryParams) (database.DirectChat, error) {
	if m.CreateDirectChatRegistryFn != nil {
		return m.CreateDirectChatRegistryFn(ctx, arg)
	}
	return database.DirectChat{}, nil
}

func (m *MockQuerier) CreateDirectBackingGroup(ctx context.Context, arg database.CreateDirectBackingGroupParams) (database.Group, error) {
	if m.CreateDirectBackingGroupFn != nil {
		return m.CreateDirectBackingGroupFn(ctx, arg)
	}
	return database.Group{}, nil
}

func (m *MockQuerier) CreateGroup(ctx context.Context, arg database.CreateGroupParams) (database.Group, error) {
	if m.CreateGroupFn != nil {
		return m.CreateGroupFn(ctx, arg)
	}
	return database.Group{}, nil
}

func (m *MockQuerier) ListGroupsByUser(ctx context.Context, userID pgtype.UUID) ([]database.Group, error) {
	if m.ListGroupsByUserFn != nil {
		return m.ListGroupsByUserFn(ctx, userID)
	}
	return nil, nil
}

func (m *MockQuerier) GetGroupByInviteCode(ctx context.Context, inviteCode pgtype.Text) (database.Group, error) {
	if m.GetGroupByInviteCodeFn != nil {
		return m.GetGroupByInviteCodeFn(ctx, inviteCode)
	}
	return database.Group{}, nil
}

func (m *MockQuerier) SoftDeleteGroup(ctx context.Context, arg database.SoftDeleteGroupParams) error {
	if m.SoftDeleteGroupFn != nil {
		return m.SoftDeleteGroupFn(ctx, arg)
	}
	return nil
}

func (m *MockQuerier) UpdateGroupAI(ctx context.Context, arg database.UpdateGroupAIParams) error {
	if m.UpdateGroupAIFn != nil {
		return m.UpdateGroupAIFn(ctx, arg)
	}
	return nil
}

func (m *MockQuerier) AddGroupMember(ctx context.Context, arg database.AddGroupMemberParams) error {
	if m.AddGroupMemberFn != nil {
		return m.AddGroupMemberFn(ctx, arg)
	}
	return nil
}

func (m *MockQuerier) RemoveGroupMember(ctx context.Context, arg database.RemoveGroupMemberParams) error {
	if m.RemoveGroupMemberFn != nil {
		return m.RemoveGroupMemberFn(ctx, arg)
	}
	return nil
}

func (m *MockQuerier) GetGroupMember(ctx context.Context, arg database.GetGroupMemberParams) (database.GroupMember, error) {
	if m.GetGroupMemberFn != nil {
		return m.GetGroupMemberFn(ctx, arg)
	}
	return database.GroupMember{}, nil
}

func (m *MockQuerier) ListGroupMembers(ctx context.Context, groupID pgtype.UUID) ([]database.ListGroupMembersRow, error) {
	if m.ListGroupMembersFn != nil {
		return m.ListGroupMembersFn(ctx, groupID)
	}
	return nil, nil
}

func (m *MockQuerier) GetGroupByID(ctx context.Context, id pgtype.UUID) (database.Group, error) {
	if m.GetGroupByIDFn != nil {
		return m.GetGroupByIDFn(ctx, id)
	}
	return database.Group{}, nil
}

func (m *MockQuerier) CreateInvite(ctx context.Context, arg database.CreateInviteParams) (database.GroupInvite, error) {
	if m.CreateInviteFn != nil {
		return m.CreateInviteFn(ctx, arg)
	}
	return database.GroupInvite{}, nil
}

func (m *MockQuerier) GetInviteByCode(ctx context.Context, code string) (database.GroupInvite, error) {
	if m.GetInviteByCodeFn != nil {
		return m.GetInviteByCodeFn(ctx, code)
	}
	return database.GroupInvite{}, nil
}

func (m *MockQuerier) IncrementInviteUseCount(ctx context.Context, code string) (int32, error) {
	if m.IncrementInviteUseCountFn != nil {
		return m.IncrementInviteUseCountFn(ctx, code)
	}
	return 1, nil
}

func (m *MockQuerier) RevokeInvite(ctx context.Context, arg database.RevokeInviteParams) error {
	if m.RevokeInviteFn != nil {
		return m.RevokeInviteFn(ctx, arg)
	}
	return nil
}

func (m *MockQuerier) ListInvitesByGroup(ctx context.Context, groupID pgtype.UUID) ([]database.GroupInvite, error) {
	if m.ListInvitesByGroupFn != nil {
		return m.ListInvitesByGroupFn(ctx, groupID)
	}
	return nil, nil
}

func (m *MockQuerier) InsertAuditLog(ctx context.Context, arg database.InsertAuditLogParams) error {
	if m.InsertAuditLogFn != nil {
		return m.InsertAuditLogFn(ctx, arg)
	}
	return nil
}

func (m *MockQuerier) ListAuditLog(ctx context.Context, arg database.ListAuditLogParams) ([]database.GroupAuditLog, error) {
	if m.ListAuditLogFn != nil {
		return m.ListAuditLogFn(ctx, arg)
	}
	return nil, nil
}

func (m *MockQuerier) BlockUser(ctx context.Context, arg database.BlockUserParams) error {
	if m.BlockUserFn != nil {
		return m.BlockUserFn(ctx, arg)
	}
	return nil
}

func (m *MockQuerier) UnblockUser(ctx context.Context, arg database.UnblockUserParams) error {
	if m.UnblockUserFn != nil {
		return m.UnblockUserFn(ctx, arg)
	}
	return nil
}

func (m *MockQuerier) ListBlockedUsers(ctx context.Context, blockerID pgtype.UUID) ([]database.ListBlockedUsersRow, error) {
	if m.ListBlockedUsersFn != nil {
		return m.ListBlockedUsersFn(ctx, blockerID)
	}
	return nil, nil
}

func (m *MockQuerier) GetCallerWorkspace(ctx context.Context, callerID pgtype.UUID) (database.Workspace, error) {
	if m.GetCallerWorkspaceFn != nil {
		return m.GetCallerWorkspaceFn(ctx, callerID)
	}
	return database.Workspace{}, nil
}

func (m *MockQuerier) CreateChat(ctx context.Context, arg database.CreateChatParams) (database.Chat, error) {
	if m.CreateChatFn != nil {
		return m.CreateChatFn(ctx, arg)
	}
	return database.Chat{}, nil
}

func (m *MockQuerier) GetChatByID(ctx context.Context, id pgtype.UUID) (database.Chat, error) {
	if m.GetChatByIDFn != nil {
		return m.GetChatByIDFn(ctx, id)
	}
	return database.Chat{}, nil
}

func (m *MockQuerier) ListChatsByGroup(ctx context.Context, groupID pgtype.UUID) ([]database.Chat, error) {
	if m.ListChatsByGroupFn != nil {
		return m.ListChatsByGroupFn(ctx, groupID)
	}
	return nil, nil
}

func (m *MockQuerier) DeleteChat(ctx context.Context, id pgtype.UUID) error {
	if m.DeleteChatFn != nil {
		return m.DeleteChatFn(ctx, id)
	}
	return nil
}

func (m *MockQuerier) ListMessagesByChat(ctx context.Context, arg database.ListMessagesByChatParams) ([]database.ListMessagesByChatRow, error) {
	if m.ListMessagesByChatFn != nil {
		return m.ListMessagesByChatFn(ctx, arg)
	}
	return nil, nil
}

func (m *MockQuerier) ListThreadMessages(ctx context.Context, parentMessageID pgtype.UUID) ([]database.ListThreadMessagesRow, error) {
	if m.ListThreadMessagesFn != nil {
		return m.ListThreadMessagesFn(ctx, parentMessageID)
	}
	return nil, nil
}

func (m *MockQuerier) CreateFileMetadata(ctx context.Context, arg database.CreateFileMetadataParams) (database.File, error) {
	if m.CreateFileMetadataFn != nil {
		return m.CreateFileMetadataFn(ctx, arg)
	}
	return database.File{
		ID:        uuidToPg(uuid.New()),
		FileName:  arg.FileName,
		Bucket:    arg.Bucket,
		ObjectKey: arg.ObjectKey,
		SizeBytes: arg.SizeBytes,
		Status:    "pending",
	}, nil
}

func (m *MockQuerier) GetFileByID(ctx context.Context, id pgtype.UUID) (database.File, error) {
	if m.GetFileByIDFn != nil {
		return m.GetFileByIDFn(ctx, id)
	}
	return database.File{}, nil
}

func (m *MockQuerier) ConfirmFileUpload(ctx context.Context, arg database.ConfirmFileUploadParams) (database.File, error) {
	if m.ConfirmFileUploadFn != nil {
		return m.ConfirmFileUploadFn(ctx, arg)
	}
	return database.File{
		ID:          arg.ID,
		Status:      "active",
		SizeBytes:   arg.SizeBytes,
		ContentType: arg.ContentType,
	}, nil
}

func (m *MockQuerier) SoftDeleteFile(ctx context.Context, id pgtype.UUID) error {
	if m.SoftDeleteFileFn != nil {
		return m.SoftDeleteFileFn(ctx, id)
	}
	return nil
}

func (m *MockQuerier) ListFilesByChat(ctx context.Context, arg database.ListFilesByChatParams) ([]database.File, error) {
	if m.ListFilesByChatFn != nil {
		return m.ListFilesByChatFn(ctx, arg)
	}
	return nil, nil
}

func (m *MockQuerier) ListStalePendingFiles(ctx context.Context, arg database.ListStalePendingFilesParams) ([]database.ListStalePendingFilesRow, error) {
	if m.ListStalePendingFilesFn != nil {
		return m.ListStalePendingFilesFn(ctx, arg)
	}
	return nil, nil
}

// ────────────────────────────────────────────────────────────────
// Mock Storage Service
// ────────────────────────────────────────────────────────────────

type MockStorageService struct {
	PresignPutURLFn   func(ctx context.Context, bucket, objectKey, contentType string, expires time.Duration) (string, error)
	PresignGetURLFn   func(ctx context.Context, bucket, objectKey, downloadFileName string, expires time.Duration) (string, error)
	StatObjectFn      func(ctx context.Context, bucket, objectKey string) (minio.ObjectInfo, error)
	PutObjectDirectFn func(ctx context.Context, bucket, objectKey string, reader io.Reader, size int64, contentType string) (minio.UploadInfo, error)
	DeleteObjectFn    func(ctx context.Context, bucket, objectKey string) error
	GetPublicURLFn    func(bucket, objectKey string) string
	AvatarsBucketFn   func() string
	AttachmentsBucketFn func() string
}

var _ storage.StorageService = (*MockStorageService)(nil)

func (m *MockStorageService) PresignPutURL(ctx context.Context, bucket, objectKey, contentType string, expires time.Duration) (string, error) {
	if m.PresignPutURLFn != nil {
		return m.PresignPutURLFn(ctx, bucket, objectKey, contentType, expires)
	}
	return "http://localhost:9000/" + bucket + "/" + objectKey + "?X-Amz-Signature=mock", nil
}

func (m *MockStorageService) PresignGetURL(ctx context.Context, bucket, objectKey, downloadFileName string, expires time.Duration) (string, error) {
	if m.PresignGetURLFn != nil {
		return m.PresignGetURLFn(ctx, bucket, objectKey, downloadFileName, expires)
	}
	return "http://localhost:9000/" + bucket + "/" + objectKey + "?X-Amz-Signature=mock", nil
}

func (m *MockStorageService) StatObject(ctx context.Context, bucket, objectKey string) (minio.ObjectInfo, error) {
	if m.StatObjectFn != nil {
		return m.StatObjectFn(ctx, bucket, objectKey)
	}
	return minio.ObjectInfo{
		Size:        1024,
		ContentType: "application/pdf",
		ETag:        `"etag-mock"`,
	}, nil
}

func (m *MockStorageService) PutObjectDirect(ctx context.Context, bucket, objectKey string, reader io.Reader, size int64, contentType string) (minio.UploadInfo, error) {
	if m.PutObjectDirectFn != nil {
		return m.PutObjectDirectFn(ctx, bucket, objectKey, reader, size, contentType)
	}
	return minio.UploadInfo{
		Bucket: bucket,
		Key:    objectKey,
		ETag:   `"etag-upload-mock"`,
		Size:   size,
	}, nil
}

func (m *MockStorageService) DeleteObject(ctx context.Context, bucket, objectKey string) error {
	if m.DeleteObjectFn != nil {
		return m.DeleteObjectFn(ctx, bucket, objectKey)
	}
	return nil
}

func (m *MockStorageService) GetPublicURL(bucket, objectKey string) string {
	if m.GetPublicURLFn != nil {
		return m.GetPublicURLFn(bucket, objectKey)
	}
	return "http://localhost:9000/" + bucket + "/" + objectKey
}

func (m *MockStorageService) AvatarsBucket() string {
	if m.AvatarsBucketFn != nil {
		return m.AvatarsBucketFn()
	}
	return "nexus-avatars"
}

func (m *MockStorageService) AttachmentsBucket() string {
	if m.AttachmentsBucketFn != nil {
		return m.AttachmentsBucketFn()
	}
	return "nexus-attachments"
}

// ────────────────────────────────────────────────────────────────
// Mock Redis Broadcaster
// ────────────────────────────────────────────────────────────────

type MockBroadcaster struct {
	PublishDirectChatCreatedFn func(ctx context.Context, recipientID uuid.UUID, payload services.DirectChatCreatedPayload) error
	PublishFn                  func(ctx context.Context, channel string, message interface{}) error
	PingFn                     func(ctx context.Context) error
	ClientFn                   func() *redis.Client
	CloseFn                    func() error
}

var _ services.Broadcaster = (*MockBroadcaster)(nil)

func (m *MockBroadcaster) PublishDirectChatCreated(ctx context.Context, recipientID uuid.UUID, payload services.DirectChatCreatedPayload) error {
	if m.PublishDirectChatCreatedFn != nil {
		return m.PublishDirectChatCreatedFn(ctx, recipientID, payload)
	}
	return nil
}

func (m *MockBroadcaster) Publish(ctx context.Context, channel string, message interface{}) error {
	if m.PublishFn != nil {
		return m.PublishFn(ctx, channel, message)
	}
	return nil
}

func (m *MockBroadcaster) Ping(ctx context.Context) error {
	if m.PingFn != nil {
		return m.PingFn(ctx)
	}
	return nil
}

func (m *MockBroadcaster) Client() *redis.Client {
	if m.ClientFn != nil {
		return m.ClientFn()
	}
	return nil
}

func (m *MockBroadcaster) Close() error {
	if m.CloseFn != nil {
		return m.CloseFn()
	}
	return nil
}

func uuidToPg(u uuid.UUID) pgtype.UUID {
	var pg pgtype.UUID
	pg.Bytes = u
	pg.Valid = true
	return pg
}

func textPg(s string) pgtype.Text {
	var t pgtype.Text
	_ = t.Scan(s)
	return t
}
