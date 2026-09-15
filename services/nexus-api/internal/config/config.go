package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// StorageConfig encapsulates MinIO S3 object storage configuration.
type StorageConfig struct {
	Endpoint          string
	PublicEndpoint    string
	AccessKeyID       string
	SecretAccessKey   string
	UseSSL            bool
	AvatarsBucket     string
	AttachmentsBucket string
	PresignExpire     time.Duration
}

// DatabaseConfig encapsulates PostgreSQL database connection parameters.
type DatabaseConfig struct {
	URL               string
	MaxConns          int32
	MinConns          int32
	MaxConnLifetime   time.Duration
	MaxConnIdleTime   time.Duration
	HealthCheckPeriod time.Duration
}

// RedisConfig encapsulates Redis connection parameters.
type RedisConfig struct {
	URL string
}

// AuthConfig encapsulates JWT authentication settings.
type AuthConfig struct {
	JWTSecret string
	JWTExpiry time.Duration
}

// CORSConfig encapsulates cross-origin resource sharing policy settings.
type CORSConfig struct {
	AllowedOrigins []string
	AllowedHeaders []string
	AllowedMethods []string
}

// Config represents the complete application runtime configuration.
type Config struct {
	Env                 string
	Port                string
	DatabaseURL         string
	RedisURL            string
	JWTSecret           string
	JWTExpiry           time.Duration
	CORSOrigin          string
	S3Endpoint          string
	S3PublicEndpoint    string
	S3AccessKey         string
	S3SecretKey         string
	S3UseSSL            bool
	S3AvatarsBucket     string
	S3AttachmentsBucket string
	S3PresignExpire     time.Duration

	// Nested domain configurations
	Storage  StorageConfig
	Database DatabaseConfig
	Redis    RedisConfig
	Auth     AuthConfig
	CORS     CORSConfig
}

// Default constants matching Docker network topology
const (
	DefaultEnv                 = "development"
	DefaultPort                = "8080"
	DefaultDatabaseURL         = "postgres://root:rootpassword@postgres:5432/nexus?sslmode=disable"
	DefaultRedisURL            = "redis://redis:6379"
	DefaultJWTSecret           = "nexus-super-secret-jwt-key-for-development"
	DefaultJWTExpiry           = 24 * time.Hour
	DefaultCORSOrigin          = "*"
	DefaultS3Endpoint          = "minio:9000"
	DefaultS3PublicEndpoint    = "http://localhost:9000"
	DefaultS3AccessKey         = "minioadmin"
	DefaultS3SecretKey         = "minioadmin"
	DefaultS3UseSSL            = false
	DefaultS3AvatarsBucket     = "nexus-avatars"
	DefaultS3AttachmentsBucket = "nexus-attachments"
	DefaultS3PresignExpire     = 15 * time.Minute
)

// Load parses environment variables and returns a strongly-typed Config.
func Load() (*Config, error) {
	env := getEnv("ENV", DefaultEnv)

	port := getEnv("PORT", DefaultPort)
	databaseURL := getEnv("DATABASE_URL", DefaultDatabaseURL)
	redisURL := getEnv("REDIS_URL", DefaultRedisURL)
	jwtSecret := getEnv("JWT_SECRET", DefaultJWTSecret)
	corsOrigin := getEnv("CORS_ORIGIN", DefaultCORSOrigin)

	// JWT Expiry
	jwtExpiry := DefaultJWTExpiry
	if v := os.Getenv("JWT_EXPIRY"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			jwtExpiry = d
		} else {
			return nil, fmt.Errorf("invalid JWT_EXPIRY %q: %w", v, err)
		}
	}

	// S3 / MinIO Configuration
	s3Endpoint := getEnv("S3_ENDPOINT", DefaultS3Endpoint)
	s3PublicEndpoint := getEnv("S3_PUBLIC_ENDPOINT", DefaultS3PublicEndpoint)
	s3AccessKey := getEnv("S3_ACCESS_KEY", DefaultS3AccessKey)
	s3SecretKey := getEnv("S3_SECRET_KEY", DefaultS3SecretKey)

	s3UseSSL := DefaultS3UseSSL
	if v := os.Getenv("S3_USE_SSL"); v != "" {
		parsed, err := strconv.ParseBool(v)
		if err != nil {
			return nil, fmt.Errorf("invalid S3_USE_SSL %q: %w", v, err)
		}
		s3UseSSL = parsed
	}

	s3AvatarsBucket := getEnv("S3_AVATARS_BUCKET", DefaultS3AvatarsBucket)
	s3AttachmentsBucket := getEnv("S3_ATTACHMENTS_BUCKET", DefaultS3AttachmentsBucket)

	s3PresignExpire := DefaultS3PresignExpire
	if v := os.Getenv("S3_PRESIGN_EXPIRE"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			s3PresignExpire = d
		} else if seconds, err := strconv.Atoi(v); err == nil {
			s3PresignExpire = time.Duration(seconds) * time.Second
		} else {
			return nil, fmt.Errorf("invalid S3_PRESIGN_EXPIRE %q: %w", v, err)
		}
	}

	// Parse CORS origins list
	rawOrigins := strings.Split(corsOrigin, ",")
	origins := make([]string, 0, len(rawOrigins))
	for _, o := range rawOrigins {
		trimmed := strings.TrimSpace(o)
		if trimmed != "" {
			origins = append(origins, trimmed)
		}
	}

	dbMaxConns := int32(80)
	if v := os.Getenv("DB_MAX_CONNS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			dbMaxConns = int32(n)
		}
	}

	cfg := &Config{
		Env:                 env,
		Port:                port,
		DatabaseURL:         databaseURL,
		RedisURL:            redisURL,
		JWTSecret:           jwtSecret,
		JWTExpiry:           jwtExpiry,
		CORSOrigin:          corsOrigin,
		S3Endpoint:          s3Endpoint,
		S3PublicEndpoint:    s3PublicEndpoint,
		S3AccessKey:         s3AccessKey,
		S3SecretKey:         s3SecretKey,
		S3UseSSL:            s3UseSSL,
		S3AvatarsBucket:     s3AvatarsBucket,
		S3AttachmentsBucket: s3AttachmentsBucket,
		S3PresignExpire:     s3PresignExpire,

		Storage: StorageConfig{
			Endpoint:          s3Endpoint,
			PublicEndpoint:    s3PublicEndpoint,
			AccessKeyID:       s3AccessKey,
			SecretAccessKey:   s3SecretKey,
			UseSSL:            s3UseSSL,
			AvatarsBucket:     s3AvatarsBucket,
			AttachmentsBucket: s3AttachmentsBucket,
			PresignExpire:     s3PresignExpire,
		},
		Database: DatabaseConfig{
			URL:               databaseURL,
			MaxConns:          dbMaxConns,
			MinConns:          15,
			MaxConnLifetime:   30 * time.Minute,
			MaxConnIdleTime:   5 * time.Minute,
			HealthCheckPeriod: 1 * time.Minute,
		},
		Redis: RedisConfig{
			URL: redisURL,
		},
		Auth: AuthConfig{
			JWTSecret: jwtSecret,
			JWTExpiry: jwtExpiry,
		},
		CORS: CORSConfig{
			AllowedOrigins: origins,
			AllowedHeaders: []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Requested-With"},
			AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		},
	}

	return cfg, nil
}

// LoadConfig provides backward-compatible configuration loading with graceful fallback.
func LoadConfig() *Config {
	cfg, err := Load()
	if err != nil {
		// Fallback to defaults
		return &Config{
			Env:                 DefaultEnv,
			Port:                DefaultPort,
			DatabaseURL:         DefaultDatabaseURL,
			RedisURL:            DefaultRedisURL,
			JWTSecret:           DefaultJWTSecret,
			JWTExpiry:           DefaultJWTExpiry,
			CORSOrigin:          DefaultCORSOrigin,
			S3Endpoint:          DefaultS3Endpoint,
			S3PublicEndpoint:    DefaultS3PublicEndpoint,
			S3AccessKey:         DefaultS3AccessKey,
			S3SecretKey:         DefaultS3SecretKey,
			S3UseSSL:            DefaultS3UseSSL,
			S3AvatarsBucket:     DefaultS3AvatarsBucket,
			S3AttachmentsBucket: DefaultS3AttachmentsBucket,
			S3PresignExpire:     DefaultS3PresignExpire,
		}
	}
	return cfg
}

func getEnv(key, fallback string) string {
	if val, ok := os.LookupEnv(key); ok && strings.TrimSpace(val) != "" {
		return val
	}
	return fallback
}
