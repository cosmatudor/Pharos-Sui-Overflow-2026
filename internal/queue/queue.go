package queue

import (
	"context"
	"keeper/internal/scanner"
)

// Queue is the contract between scanner and settler.
// InMemory implements it now; Kafka implements it later.
type Queue interface {
	Publish(ctx context.Context, m scanner.Market) error
	Consume(ctx context.Context) <-chan scanner.Market
}

// InMemory is a buffered channel queue for local development and testing.
type InMemory struct {
	ch chan scanner.Market
}

func NewInMemory(size int) *InMemory {
	return &InMemory{ch: make(chan scanner.Market, size)}
}

func (q *InMemory) Publish(ctx context.Context, m scanner.Market) error {
	select {
	case q.ch <- m:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (q *InMemory) Consume(ctx context.Context) <-chan scanner.Market {
	return q.ch
}
