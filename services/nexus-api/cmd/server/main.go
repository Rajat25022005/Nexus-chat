package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"nexus/nexus-api/internal/config"
	"nexus/nexus-api/internal/database"
	"nexus/nexus-api/internal/handlers"
	"nexus/nexus-api/internal/middleware"
	"nexus/nexus-api/internal/services"
	"nexus/nexus-api/internal/storage"
	"nexus/nexus-api/internal/telemetry"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Printf("Warning: config.Load() encountered error (%v); falling back to default configuration", err)
		cfg = config.LoadConfig()
	}

	log.Printf("Starting Nexus API service in %s mode on port %s...", cfg.Env, cfg.Port)

	ctx := context.Background()

	// 1. Initialize PostgreSQL Connection Pool
	dbConfig, err := pgxpool.ParseConfig(cfg.Database.URL)
	if err != nil {
		log.Fatalf("Fatal: Failed to parse Database URL: %v", err)
	}

	dbConfig.MaxConns = cfg.Database.MaxConns
	dbConfig.MinConns = cfg.Database.MinConns
	dbConfig.MaxConnLifetime = cfg.Database.MaxConnLifetime
	dbConfig.MaxConnIdleTime = cfg.Database.MaxConnIdleTime
	dbConfig.HealthCheckPeriod = cfg.Database.HealthCheckPeriod
	dbConfig.ConnConfig.Tracer = &telemetry.PGXQueryTracer{}

	var pool *pgxpool.Pool
	maxRetries := 5
	for attempt := 1; attempt <= maxRetries; attempt++ {
		log.Printf("Connecting to PostgreSQL (attempt %d/%d)...", attempt, maxRetries)
		pool, err = pgxpool.NewWithConfig(ctx, dbConfig)
		if err == nil {
			pingCtx, pingCancel := context.WithTimeout(ctx, 3*time.Second)
			err = pool.Ping(pingCtx)
			pingCancel()
			if err == nil {
				log.Println("✅ Successfully connected and pinged PostgreSQL.")
				break
			}
			pool.Close()
		}

		log.Printf("Database connection attempt %d failed: %v", attempt, err)
		if attempt == maxRetries {
			log.Fatalf("Fatal: Failed to connect to PostgreSQL after %d attempts: %v", maxRetries, err)
		}
		time.Sleep(2 * time.Second)
	}
	defer pool.Close()

	queries := database.New(pool)

	// 2. Initialize Redis Client & Broadcaster
	var broadcaster services.Broadcaster
	redisClient, err := services.NewRedisClient(cfg.Redis.URL)
	if err != nil {
		log.Printf("Warning: Redis client connection failed (%v); real-time socket events will fail open", err)
	} else {
		log.Println("✅ Successfully connected to Redis.")
		broadcaster = services.NewRedisBroadcaster(redisClient)
		defer func() {
			if broadcaster != nil {
				_ = broadcaster.Close()
			}
		}()
	}

	// 3. Initialize MinIO S3 Object Storage Service (Dual-Endpoint Architecture)
	storageService, err := storage.NewStorageService(
		cfg.Storage.Endpoint,
		cfg.Storage.PublicEndpoint,
		cfg.Storage.AccessKeyID,
		cfg.Storage.SecretAccessKey,
		cfg.Storage.UseSSL,
		cfg.Storage.AvatarsBucket,
		cfg.Storage.AttachmentsBucket,
	)
	if err != nil {
		log.Fatalf("Fatal: Failed to initialize MinIO storage service: %v", err)
	}
	log.Printf("✅ S3 Storage Service initialized (Internal: %s, Public: %s)",
		cfg.Storage.Endpoint, cfg.Storage.PublicEndpoint)

	// 4. Configure Gin Router & Middleware
	if cfg.Env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()
	if cfg.Env != "production" {
		router.Use(gin.Logger())
	}
	router.Use(gin.Recovery())

	// Multi-origin CORS Middleware
	router.Use(middleware.CORSMiddleware(cfg.CORS.AllowedOrigins...))

	// 5. Initialize Handlers and Register Routes
	h := handlers.New(queries, pool, storageService, broadcaster, cfg)
	h.RegisterRoutes(router)

	// 6. HTTP Server Bootstrap with Hardened Timeouts for Hyperscale (50k+ Workers)
	srv := &http.Server{
		Addr:              fmt.Sprintf(":%s", cfg.Port),
		Handler:           router,
		ReadHeaderTimeout: 30 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20, // 1 MB
	}

	serverErrors := make(chan error, 1)
	go func() {
		log.Printf("🚀 Nexus API server listening on http://0.0.0.0:%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			serverErrors <- err
		}
	}()

	// 7. Graceful Shutdown on OS Signals
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-serverErrors:
		log.Fatalf("Server encounter error: %v", err)
	case sig := <-quit:
		log.Printf("Received signal %s; beginning graceful shutdown...", sig)
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("Forced server shutdown: %v", err)
			_ = srv.Close()
		}
		log.Println("Nexus API server stopped cleanly.")
	}
}
