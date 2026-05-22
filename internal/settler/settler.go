package settler

import (
	"context"
	"fmt"
	"keeper/internal/scanner"
	"sync"
)

type Protocol interface {
	Settle(ctx context.Context, market scanner.Market) (txHash string, err error)
}

type Store interface {
	IsSettled(ctx context.Context, marketID string) (bool, error)
	MarkInFlight(ctx context.Context, marketID string) (claimed bool, err error)
	MarkSettled(ctx context.Context, marketID string, txHash string) error
	MarkFailed(ctx context.Context, marketID string, reason string) error
}

type Settler struct {
	protocol Protocol
	store    Store
	workers  int
}

func New(protocol Protocol, store Store, workers int) *Settler {
	return &Settler{
		protocol: protocol,
		store:    store,
		workers:  workers,
	}
}

// Start consumes markets from the queue and settles them concurrently.
// Blocks until the queue channel is closed or ctx is cancelled.
func (s *Settler) Start(ctx context.Context, queue <-chan scanner.Market) {
	var wg sync.WaitGroup

	for i := 0; i < s.workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case m, ok := <-queue:
					if !ok {
						return
					}
					s.settle(ctx, m)
				}
			}
		}()
	}

	wg.Wait()
}

func (s *Settler) settle(ctx context.Context, m scanner.Market) {
	settled, err := s.store.IsSettled(ctx, m.ID)
	if err != nil {
		fmt.Printf("store check failed for market %s: %v\n", m.ID, err)
		return
	}
	if settled {
		return
	}

	claimed, err := s.store.MarkInFlight(ctx, m.ID)
	if err != nil {
		fmt.Printf("failed to mark in-flight for market %s: %v\n", m.ID, err)
		return
	}
	if !claimed {
		return
	}

	txHash, err := s.protocol.Settle(ctx, m)
	if err != nil {
		_ = s.store.MarkFailed(ctx, m.ID, err.Error())
		fmt.Printf("settlement failed for market %s: %v\n", m.ID, err)
		return
	}

	fmt.Printf("settled market %s tx=%s\n", m.ID, txHash)
	if err := s.store.MarkSettled(ctx, m.ID, txHash); err != nil {
		fmt.Printf("failed to record settlement for market %s: %v\n", m.ID, err)
	}
}
