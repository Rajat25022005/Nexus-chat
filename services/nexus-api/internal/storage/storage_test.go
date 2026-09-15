package storage

import (
	"context"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestNewStorageService_ValidEndpoints(t *testing.T) {
	svc, err := NewStorageService(
		"minio:9000",
		"http://localhost:9000",
		"testaccess",
		"testsecret",
		false,
		"nexus-avatars",
		"nexus-attachments",
	)
	if err != nil {
		t.Fatalf("expected successful initialization, got: %v", err)
	}

	if svc.AvatarsBucket() != "nexus-avatars" {
		t.Errorf("expected avatars bucket 'nexus-avatars', got %s", svc.AvatarsBucket())
	}
	if svc.AttachmentsBucket() != "nexus-attachments" {
		t.Errorf("expected attachments bucket 'nexus-attachments', got %s", svc.AttachmentsBucket())
	}
}

func TestNewStorageService_WithSchemeInInternal(t *testing.T) {
	svc, err := NewStorageService(
		"http://minio:9000",
		"http://localhost:9000",
		"testaccess",
		"testsecret",
		false,
		"avatars",
		"attachments",
	)
	if err != nil {
		t.Fatalf("expected successful initialization with http:// internal prefix, got: %v", err)
	}
	if svc == nil {
		t.Fatal("expected non-nil service")
	}
}

func TestNewStorageService_InvalidPublicEndpoint(t *testing.T) {
	_, err := NewStorageService(
		"minio:9000",
		"http://invalid :::: url",
		"testaccess",
		"testsecret",
		false,
		"avatars",
		"attachments",
	)
	if err == nil {
		t.Fatalf("expected error on invalid public endpoint, got nil")
	}
}

func TestStorageService_GetPublicURL(t *testing.T) {
	svc, err := NewStorageService(
		"minio:9000",
		"http://localhost:9000/",
		"testaccess",
		"testsecret",
		false,
		"nexus-avatars",
		"nexus-attachments",
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	publicURL := svc.GetPublicURL("nexus-avatars", "users/123/avatar.png")
	expected := "http://localhost:9000/nexus-avatars/users/123/avatar.png"
	if publicURL != expected {
		t.Errorf("expected %s, got %s", expected, publicURL)
	}
}

func TestStorageService_PresignPutURL(t *testing.T) {
	svc, err := NewStorageService(
		"minio:9000",
		"http://localhost:9000",
		"testaccess",
		"testsecret",
		false,
		"nexus-avatars",
		"nexus-attachments",
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ctx := context.Background()
	putURL, err := svc.PresignPutURL(ctx, "nexus-avatars", "test-key.jpg", "image/jpeg", 15*time.Minute)
	if err != nil {
		t.Fatalf("failed to generate presigned PUT URL: %v", err)
	}

	parsed, err := url.Parse(putURL)
	if err != nil {
		t.Fatalf("invalid generated URL: %v", err)
	}

	if parsed.Host != "localhost:9000" {
		t.Errorf("expected host localhost:9000 matching public endpoint, got %s", parsed.Host)
	}
	if !strings.Contains(parsed.Path, "nexus-avatars/test-key.jpg") {
		t.Errorf("expected path to contain bucket and key, got %s", parsed.Path)
	}
	if !strings.Contains(putURL, "X-Amz-Signature") {
		t.Errorf("expected SigV4 signature in presigned URL")
	}
}

func TestStorageService_PresignGetURL_WithDisposition(t *testing.T) {
	svc, err := NewStorageService(
		"minio:9000",
		"http://localhost:9000",
		"testaccess",
		"testsecret",
		false,
		"nexus-avatars",
		"nexus-attachments",
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ctx := context.Background()
	getURL, err := svc.PresignGetURL(ctx, "nexus-attachments", "chat/uuid/report.pdf", "Quarterly Report.pdf", 15*time.Minute)
	if err != nil {
		t.Fatalf("failed to generate presigned GET URL: %v", err)
	}

	parsed, err := url.Parse(getURL)
	if err != nil {
		t.Fatalf("invalid generated URL: %v", err)
	}

	if parsed.Host != "localhost:9000" {
		t.Errorf("expected host localhost:9000, got %s", parsed.Host)
	}
	disposition := parsed.Query().Get("response-content-disposition")
	if !strings.Contains(disposition, "Quarterly+Report.pdf") && !strings.Contains(disposition, "Quarterly%20Report.pdf") {
		t.Errorf("expected response-content-disposition query parameter to contain encoded filename, got %s", disposition)
	}
}

func TestStorageService_PresignGetURL_NoDisposition(t *testing.T) {
	svc, err := NewStorageService(
		"minio:9000",
		"http://localhost:9000",
		"testaccess",
		"testsecret",
		false,
		"nexus-avatars",
		"nexus-attachments",
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ctx := context.Background()
	getURL, err := svc.PresignGetURL(ctx, "nexus-attachments", "chat/uuid/report.pdf", "", 15*time.Minute)
	if err != nil {
		t.Fatalf("failed to generate presigned GET URL: %v", err)
	}

	parsed, err := url.Parse(getURL)
	if err != nil {
		t.Fatalf("invalid generated URL: %v", err)
	}

	if parsed.Query().Get("response-content-disposition") != "" {
		t.Errorf("expected empty response-content-disposition when no filename provided")
	}
}

func TestNewStorageService_WithSSL(t *testing.T) {
	svc, err := NewStorageService(
		"s3.amazonaws.com",
		"https://s3.amazonaws.com",
		"testaccess",
		"testsecret",
		true,
		"avatars",
		"attachments",
	)
	if err != nil {
		t.Fatalf("unexpected error initializing with SSL: %v", err)
	}
	if svc == nil {
		t.Fatal("expected non-nil service with SSL")
	}
}
