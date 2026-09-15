package services

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func TestNewRedisClient_InvalidURL(t *testing.T) {
	_, err := NewRedisClient("invalid-redis-url-format")
	if err == nil {
		t.Errorf("expected error for invalid redis url, got nil")
	}
}

func TestRedisBroadcaster_NilClient(t *testing.T) {
	broadcaster := NewRedisBroadcaster(nil)
	ctx := context.Background()

	t.Run("publish returns error on nil client", func(t *testing.T) {
		err := broadcaster.Publish(ctx, "test:channel", "hello")
		if err == nil {
			t.Errorf("expected error when publishing with nil client")
		}
	})

	t.Run("ping returns error on nil client", func(t *testing.T) {
		err := broadcaster.Ping(ctx)
		if err == nil {
			t.Errorf("expected error when pinging with nil client")
		}
	})

	t.Run("client returns nil", func(t *testing.T) {
		if broadcaster.Client() != nil {
			t.Errorf("expected nil client, got %v", broadcaster.Client())
		}
	})

	t.Run("close returns nil on nil client", func(t *testing.T) {
		if err := broadcaster.Close(); err != nil {
			t.Errorf("expected nil error on close, got %v", err)
		}
	})
}

func TestRedisBroadcaster_MarshalError(t *testing.T) {
	dummyClient := redis.NewClient(&redis.Options{})
	broadcaster := NewRedisBroadcaster(dummyClient)
	ctx := context.Background()

	// Channel types cannot be marshaled to JSON
	err := broadcaster.Publish(ctx, "test:chan", make(chan int))
	if err == nil {
		t.Errorf("expected JSON marshaling error, got nil")
	}
}

func TestRedisBroadcaster_WithLiveClient(t *testing.T) {
	// Attempt connection to the local Docker Redis instance
	client, err := NewRedisClient("redis://localhost:6379/0")
	if err != nil {
		t.Skipf("skipping live Redis test (Redis not reachable on localhost:6379): %v", err)
		return
	}
	defer client.Close()

	broadcaster := NewRedisBroadcaster(client)
	ctx := context.Background()

	t.Run("ping live redis succeeds", func(t *testing.T) {
		if err := broadcaster.Ping(ctx); err != nil {
			t.Fatalf("expected ping to succeed, got %v", err)
		}
	})

	t.Run("publish string, bytes, and struct payload", func(t *testing.T) {
		// String message
		if err := broadcaster.Publish(ctx, "test:string", "hello world"); err != nil {
			t.Errorf("failed to publish string: %v", err)
		}

		// Byte slice message
		if err := broadcaster.Publish(ctx, "test:bytes", []byte(`{"event":"test"}`)); err != nil {
			t.Errorf("failed to publish bytes: %v", err)
		}

		// Struct serialization message
		type CustomEvent struct {
			Name string `json:"name"`
			Seq  int    `json:"seq"`
		}
		if err := broadcaster.Publish(ctx, "test:struct", CustomEvent{Name: "ping", Seq: 1}); err != nil {
			t.Errorf("failed to publish struct: %v", err)
		}
	})

	t.Run("publish direct chat created envelope", func(t *testing.T) {
		recipientID := uuid.New()
		payload := DirectChatCreatedPayload{
			ChatID:        uuid.New(),
			InitiatorID:   uuid.New(),
			InitiatorName: "Test User",
			CreatedAt:     time.Now().UTC(),
		}

		if err := broadcaster.PublishDirectChatCreated(ctx, recipientID, payload); err != nil {
			t.Fatalf("expected PublishDirectChatCreated to succeed, got %v", err)
		}
	})

	t.Run("client accessor and close", func(t *testing.T) {
		c := broadcaster.Client()
		if c == nil {
			t.Errorf("expected non-nil redis client")
		}

		opt := &redis.Options{Addr: "localhost:6379"}
		tempClient := redis.NewClient(opt)
		tempBroadcaster := NewRedisBroadcaster(tempClient)
		if err := tempBroadcaster.Close(); err != nil {
			t.Errorf("expected clean close, got %v", err)
		}
	})
}
