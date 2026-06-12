package settler

import (
	"context"
	"errors"
	"fmt"
	keepererrors "keeper/internal/errors"
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
		fmt.Printf("[settler] db check error id=%s: %v\n", m.ID, err)
		return
	}
	if settled {
		return
	}

	claimed, err := s.store.MarkInFlight(ctx, m.ID)
	if err != nil {
		fmt.Printf("[settler] mark in-flight error id=%s: %v\n", m.ID, err)
		return
	}
	if !claimed {
		return
	}

	fmt.Printf("[settler] CLAIMED id=%s — calling Settle()\n", m.ID)
	txHash, err := s.protocol.Settle(ctx, m)
	if errors.Is(err, keepererrors.ErrAlreadySettled) {
		fmt.Printf("[settler] id=%s already settled by another keeper (registry guard)\n", m.ID)
		_ = s.store.MarkSettled(ctx, m.ID, "external")
		return
	}
	if errors.Is(err, keepererrors.ErrAlreadyRedeemed) {
		fmt.Printf("[settler] id=%s stale API data — position gone on-chain\n", m.ID)
		_ = s.store.MarkSettled(ctx, m.ID, "already_redeemed")
		return
	}
	if errors.Is(err, keepererrors.ErrInsufficientGas) {
		fmt.Printf("[settler] id=%s insufficient gas — leaving in_flight, top up wallet\n", m.ID)
		return
	}
	if err != nil {
		_ = s.store.MarkFailed(ctx, m.ID, err.Error())
		fmt.Printf("[settler] id=%s FAILED: %v\n", m.ID, err)
		return
	}

	fmt.Printf("[settler] id=%s SETTLED tx=%s\n", m.ID, txHash)
	if err := s.store.MarkSettled(ctx, m.ID, txHash); err != nil {
		fmt.Printf("[settler] id=%s db write error: %v\n", m.ID, err)
	}
}
