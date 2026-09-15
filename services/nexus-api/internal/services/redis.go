package services

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"nexus/nexus-api/internal/telemetry"
)

const (
	// BroadcastChannel is the canonical Redis Pub/Sub channel consumed by nexus-socket
	BroadcastChannel = "nexus:broadcast"
)

// BroadcastEnvelope defines the wire structure expected by the Elixir subscriber.
type BroadcastEnvelope struct {
	Topic   string      `json:"topic"`
	Event   string      `json:"event"`
	Payload interface{} `json:"payload"`
}

// DirectChatCreatedPayload represents the payload data for direct_chat_created events.
type DirectChatCreatedPayload struct {
	ChatID        uuid.UUID `json:"chat_id"`
	InitiatorID   uuid.UUID `json:"initiator_id"`
	InitiatorName string    `json:"initiator_name"`
	CreatedAt     time.Time `json:"created_at"`
}

// Broadcaster defines the interface for publishing events to real-time subscribers.
type Broadcaster interface {
	PublishDirectChatCreated(ctx context.Context, recipientID uuid.UUID, payload DirectChatCreatedPayload) error
	Publish(ctx context.Context, channel string, message interface{}) error
	Ping(ctx context.Context) error
	Client() *redis.Client
	Close() error
}

// RedisBroadcaster publishes cross-service event notifications using Redis Pub/Sub.
type RedisBroadcaster struct {
	client *redis.Client
}

// NewRedisClient initializes and health-checks a Redis client from a connection URL.
func NewRedisClient(redisURL string) (*redis.Client, error) {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse redis url: %w", err)
	}

	// Performance and connection pooling configuration
	opt.PoolSize = 50
	opt.MinIdleConns = 10
	opt.DialTimeout = 5 * time.Second
	opt.ReadTimeout = 3 * time.Second
	opt.WriteTimeout = 3 * time.Second

	client := redis.NewClient(opt)

	// Attach telemetry hook for command duration, p50/p95/p99, errors, and RTT
	client.AddHook(&telemetry.RedisHook{})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return client, fmt.Errorf("redis connection ping failed: %w", err)
	}

	telemetry.StartNetworkRTTProbe(context.Background(), client, 500*time.Millisecond)

	return client, nil
}

// NewRedisBroadcaster creates a Broadcaster wrapping an existing Redis client.
func NewRedisBroadcaster(client *redis.Client) Broadcaster {
	return &RedisBroadcaster{client: client}
}

// PublishDirectChatCreated sends a targeted notification to the recipient user topic.
func (b *RedisBroadcaster) PublishDirectChatCreated(ctx context.Context, recipientID uuid.UUID, payload DirectChatCreatedPayload) error {
	envelope := BroadcastEnvelope{
		Topic:   fmt.Sprintf("user:%s", recipientID.String()),
		Event:   "direct_chat_created",
		Payload: payload,
	}
	return b.Publish(ctx, BroadcastChannel, envelope)
}

// Publish serializes and publishes an event envelope to a Redis channel.
func (b *RedisBroadcaster) Publish(ctx context.Context, channel string, message interface{}) error {
	if b.client == nil {
		return fmt.Errorf("redis client is not initialized")
	}

	var data []byte
	switch v := message.(type) {
	case []byte:
		data = v
	case string:
		data = []byte(v)
	default:
		marshaled, err := json.Marshal(message)
		if err != nil {
			return fmt.Errorf("failed to marshal broadcast event: %w", err)
		}
		data = marshaled
	}

	return b.client.Publish(ctx, channel, data).Err()
}

// Ping checks Redis connectivity health.
func (b *RedisBroadcaster) Ping(ctx context.Context) error {
	if b.client == nil {
		return fmt.Errorf("redis client is not initialized")
	}
	return b.client.Ping(ctx).Err()
}

// Client returns the underlying *redis.Client instance.
func (b *RedisBroadcaster) Client() *redis.Client {
	return b.client
}

// Close gracefully disconnects the Redis client.
func (b *RedisBroadcaster) Close() error {
	if b.client != nil {
		return b.client.Close()
	}
	return nil
}
