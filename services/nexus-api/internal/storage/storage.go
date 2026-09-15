package storage

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// StorageService defines operations for cloud object storage.
type StorageService interface {
	PresignPutURL(ctx context.Context, bucket, objectKey, contentType string, expires time.Duration) (string, error)
	PresignGetURL(ctx context.Context, bucket, objectKey, downloadFileName string, expires time.Duration) (string, error)
	StatObject(ctx context.Context, bucket, objectKey string) (minio.ObjectInfo, error)
	PutObjectDirect(ctx context.Context, bucket, objectKey string, reader io.Reader, size int64, contentType string) (minio.UploadInfo, error)
	DeleteObject(ctx context.Context, bucket, objectKey string) error
	GetPublicURL(bucket, objectKey string) string
	AvatarsBucket() string
	AttachmentsBucket() string
}

type minioStorageService struct {
	internalClient    *minio.Client // For backend server-to-server RPCs (minio:9000)
	presignClient     *minio.Client // For calculating client SigV4 signatures (localhost:9000)
	publicEndpointURL *url.URL
	avatarsBucket     string
	attachmentsBucket string
}

// NewStorageService instantiates a dual-endpoint MinIO storage service.
func NewStorageService(
	internalEndpoint string, // e.g. "minio:9000"
	publicEndpoint string,   // e.g. "http://localhost:9000"
	accessKey string,
	secretKey string,
	useSSL bool,
	avatarsBucket string,
	attachmentsBucket string,
) (StorageService, error) {
	// Clean internal endpoint host
	internalHost := internalEndpoint
	if strings.Contains(internalHost, "://") {
		if u, err := url.Parse(internalHost); err == nil && u.Host != "" {
			internalHost = u.Host
		}
	}

	// 1. Initialize Internal Client (used for StatObject, PutObjectDirect, DeleteObject)
	internalClient, err := minio.New(internalHost, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
		Region: "us-east-1",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to initialize internal minio client: %w", err)
	}

	// 2. Parse Public Endpoint for Presigner Client
	pubURL, err := url.Parse(publicEndpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid S3_PUBLIC_ENDPOINT %q: %w", publicEndpoint, err)
	}

	pubHost := pubURL.Host
	if pubHost == "" {
		pubHost = pubURL.Path
		scheme := "http"
		if useSSL {
			scheme = "https"
		}
		pubURL, err = url.Parse(fmt.Sprintf("%s://%s", scheme, pubHost))
		if err != nil {
			return nil, fmt.Errorf("failed to re-parse S3_PUBLIC_ENDPOINT: %w", err)
		}
	}
	pubSecure := strings.EqualFold(pubURL.Scheme, "https")

	// 3. Initialize Presign Client (Host in SigV4 signature matches what client browser sends)
	presignClient, err := minio.New(pubURL.Host, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: pubSecure,
		Region: "us-east-1",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to initialize presign minio client: %w", err)
	}

	return &minioStorageService{
		internalClient:    internalClient,
		presignClient:     presignClient,
		publicEndpointURL: pubURL,
		avatarsBucket:     avatarsBucket,
		attachmentsBucket: attachmentsBucket,
	}, nil
}

func (s *minioStorageService) PresignPutURL(ctx context.Context, bucket, objectKey, contentType string, expires time.Duration) (string, error) {
	u, err := s.presignClient.PresignedPutObject(ctx, bucket, objectKey, expires)
	if err != nil {
		return "", fmt.Errorf("failed to generate presigned PUT url: %w", err)
	}
	return u.String(), nil
}

func (s *minioStorageService) PresignGetURL(ctx context.Context, bucket, objectKey, downloadFileName string, expires time.Duration) (string, error) {
	reqParams := make(url.Values)
	if downloadFileName != "" {
		// Enforce Content-Disposition header in pre-signed URL to ensure correct download filename
		disposition := fmt.Sprintf("attachment; filename=\"%s\"", url.QueryEscape(downloadFileName))
		reqParams.Set("response-content-disposition", disposition)
	}

	u, err := s.presignClient.PresignedGetObject(ctx, bucket, objectKey, expires, reqParams)
	if err != nil {
		return "", fmt.Errorf("failed to generate presigned GET url: %w", err)
	}
	return u.String(), nil
}

func (s *minioStorageService) StatObject(ctx context.Context, bucket, objectKey string) (minio.ObjectInfo, error) {
	return s.internalClient.StatObject(ctx, bucket, objectKey, minio.StatObjectOptions{})
}

func (s *minioStorageService) PutObjectDirect(ctx context.Context, bucket, objectKey string, reader io.Reader, size int64, contentType string) (minio.UploadInfo, error) {
	return s.internalClient.PutObject(ctx, bucket, objectKey, reader, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
}

func (s *minioStorageService) DeleteObject(ctx context.Context, bucket, objectKey string) error {
	return s.internalClient.RemoveObject(ctx, bucket, objectKey, minio.RemoveObjectOptions{})
}

func (s *minioStorageService) GetPublicURL(bucket, objectKey string) string {
	base := strings.TrimRight(s.publicEndpointURL.String(), "/")
	return fmt.Sprintf("%s/%s/%s", base, bucket, objectKey)
}

func (s *minioStorageService) AvatarsBucket() string {
	return s.avatarsBucket
}

func (s *minioStorageService) AttachmentsBucket() string {
	return s.attachmentsBucket
}
