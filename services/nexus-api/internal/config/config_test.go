package config

import (
	"testing"
	"time"
)

func TestConfig_Defaults(t *testing.T) {
	// Ensure clean environment for test
	t.Setenv("PORT", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("REDIS_URL", "")
	t.Setenv("JWT_SECRET", "")
	t.Setenv("CORS_ORIGIN", "")
	t.Setenv("S3_ENDPOINT", "")
	t.Setenv("S3_PUBLIC_ENDPOINT", "")
	t.Setenv("S3_ACCESS_KEY", "")
	t.Setenv("S3_SECRET_KEY", "")
	t.Setenv("S3_USE_SSL", "")
	t.Setenv("S3_AVATARS_BUCKET", "")
	t.Setenv("S3_ATTACHMENTS_BUCKET", "")
	t.Setenv("S3_PRESIGN_EXPIRE", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected no error loading defaults, got: %v", err)
	}

	if cfg.Port != "8080" {
		t.Errorf("expected default Port 8080, got %s", cfg.Port)
	}
	if cfg.DatabaseURL != DefaultDatabaseURL {
		t.Errorf("expected default DatabaseURL %s, got %s", DefaultDatabaseURL, cfg.DatabaseURL)
	}
	if cfg.RedisURL != DefaultRedisURL {
		t.Errorf("expected default RedisURL %s, got %s", DefaultRedisURL, cfg.RedisURL)
	}
	if cfg.S3Endpoint != "minio:9000" {
		t.Errorf("expected default S3Endpoint minio:9000, got %s", cfg.S3Endpoint)
	}
	if cfg.S3PublicEndpoint != "http://localhost:9000" {
		t.Errorf("expected default S3PublicEndpoint http://localhost:9000, got %s", cfg.S3PublicEndpoint)
	}
	if cfg.S3UseSSL != false {
		t.Errorf("expected default S3UseSSL false, got %v", cfg.S3UseSSL)
	}
	if cfg.S3AvatarsBucket != "nexus-avatars" {
		t.Errorf("expected default S3AvatarsBucket nexus-avatars, got %s", cfg.S3AvatarsBucket)
	}
	if cfg.S3AttachmentsBucket != "nexus-attachments" {
		t.Errorf("expected default S3AttachmentsBucket nexus-attachments, got %s", cfg.S3AttachmentsBucket)
	}
	if cfg.S3PresignExpire != 15*time.Minute {
		t.Errorf("expected default S3PresignExpire 15m, got %v", cfg.S3PresignExpire)
	}
}

func TestConfig_CustomEnvOverrides(t *testing.T) {
	t.Setenv("PORT", "9090")
	t.Setenv("DATABASE_URL", "postgres://custom:pass@localhost:5432/testdb")
	t.Setenv("REDIS_URL", "redis://custom-redis:6380")
	t.Setenv("JWT_SECRET", "custom-secret-key-999")
	t.Setenv("CORS_ORIGIN", "https://app.nexusainow.online, https://admin.nexusainow.online")
	t.Setenv("S3_ENDPOINT", "s3.internal:9000")
	t.Setenv("S3_PUBLIC_ENDPOINT", "https://storage.nexusainow.online")
	t.Setenv("S3_ACCESS_KEY", "customaccess")
	t.Setenv("S3_SECRET_KEY", "customsecret")
	t.Setenv("S3_USE_SSL", "true")
	t.Setenv("S3_AVATARS_BUCKET", "prod-avatars")
	t.Setenv("S3_ATTACHMENTS_BUCKET", "prod-attachments")
	t.Setenv("S3_PRESIGN_EXPIRE", "30m")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected no error loading overridden config, got: %v", err)
	}

	if cfg.Port != "9090" {
		t.Errorf("expected Port 9090, got %s", cfg.Port)
	}
	if cfg.DatabaseURL != "postgres://custom:pass@localhost:5432/testdb" {
		t.Errorf("expected custom DatabaseURL, got %s", cfg.DatabaseURL)
	}
	if cfg.RedisURL != "redis://custom-redis:6380" {
		t.Errorf("expected custom RedisURL, got %s", cfg.RedisURL)
	}
	if cfg.JWTSecret != "custom-secret-key-999" {
		t.Errorf("expected custom JWTSecret, got %s", cfg.JWTSecret)
	}
	if cfg.S3Endpoint != "s3.internal:9000" {
		t.Errorf("expected custom S3Endpoint, got %s", cfg.S3Endpoint)
	}
	if cfg.S3PublicEndpoint != "https://storage.nexusainow.online" {
		t.Errorf("expected custom S3PublicEndpoint, got %s", cfg.S3PublicEndpoint)
	}
	if cfg.S3UseSSL != true {
		t.Errorf("expected S3UseSSL true, got %v", cfg.S3UseSSL)
	}
	if cfg.S3AvatarsBucket != "prod-avatars" {
		t.Errorf("expected S3AvatarsBucket prod-avatars, got %s", cfg.S3AvatarsBucket)
	}
	if cfg.S3AttachmentsBucket != "prod-attachments" {
		t.Errorf("expected S3AttachmentsBucket prod-attachments, got %s", cfg.S3AttachmentsBucket)
	}
	if cfg.S3PresignExpire != 30*time.Minute {
		t.Errorf("expected S3PresignExpire 30m, got %v", cfg.S3PresignExpire)
	}

	// Verify CORS parsed slices
	if len(cfg.CORS.AllowedOrigins) != 2 {
		t.Fatalf("expected 2 allowed origins, got %d", len(cfg.CORS.AllowedOrigins))
	}
	if cfg.CORS.AllowedOrigins[0] != "https://app.nexusainow.online" {
		t.Errorf("expected first origin trimmed, got %s", cfg.CORS.AllowedOrigins[0])
	}
}

func TestConfig_InvalidS3UseSSL(t *testing.T) {
	t.Setenv("S3_USE_SSL", "not-a-bool")
	_, err := Load()
	if err == nil {
		t.Fatalf("expected error on invalid S3_USE_SSL, got nil")
	}
}

func TestConfig_InvalidPresignExpire(t *testing.T) {
	t.Setenv("S3_USE_SSL", "false")
	t.Setenv("S3_PRESIGN_EXPIRE", "invalid-duration")
	_, err := Load()
	if err == nil {
		t.Fatalf("expected error on invalid S3_PRESIGN_EXPIRE, got nil")
	}
}

func TestConfig_PresignExpireSecondsInteger(t *testing.T) {
	t.Setenv("S3_USE_SSL", "false")
	t.Setenv("S3_PRESIGN_EXPIRE", "600")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected valid load with integer seconds, got error: %v", err)
	}
	if cfg.S3PresignExpire != 600*time.Second {
		t.Errorf("expected 600s, got %v", cfg.S3PresignExpire)
	}
}

func TestConfig_LoadConfigFallback(t *testing.T) {
	t.Setenv("S3_USE_SSL", "invalid")
	cfg := LoadConfig()
	if cfg == nil {
		t.Fatalf("expected non-nil fallback config")
	}
	if cfg.Port != DefaultPort {
		t.Errorf("expected default port in fallback, got %s", cfg.Port)
	}
}
