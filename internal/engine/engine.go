package engine

import (
	"context"
	"fmt"
	"keeper/internal/queue"
	"keeper/internal/scanner"
	"keeper/internal/settler"
	"sync"
	"time"
)

const staleClaimTimeout = 2 * time.Minute

type Store interface {
	ReclaimStale(ctx context.Context, olderThan time.Duration) (int64, error)
}

type Engine struct {
	scanner *scanner.Scanner
	queue   queue.Queue
	settler *settler.Settler
	store   Store
}

func New(s *scanner.Scanner, q queue.Queue, st *settler.Settler, store Store) *Engine {
	return &Engine{
		scanner: s,
		queue:   q,
		settler: st,
		store:   store,
	}
}

// Run starts all components and blocks until ctx is cancelled.
func (e *Engine) Run(ctx context.Context) {
	markets := e.scanner.Start(ctx)

	var wg sync.WaitGroup

	// bridge: read expired markets from scanner, publish to queue
	wg.Add(1)
	go func() {
		defer wg.Done()
		for m := range markets {
			if err := e.queue.Publish(ctx, m); err != nil {
				fmt.Printf("failed to publish market %s: %v\n", m.ID, err)
			}
		}
	}()

	// settler: consume from queue, submit settlement transactions
	wg.Add(1)
	go func() {
		defer wg.Done()
		e.settler.Start(ctx, e.queue.Consume(ctx))
	}()

	// reaper: reclaim stale in_flight claims from crashed keeper instances
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(staleClaimTimeout)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				n, err := e.store.ReclaimStale(ctx, staleClaimTimeout)
				if err != nil {
					fmt.Printf("reaper error: %v\n", err)
				} else if n > 0 {
					fmt.Printf("reaper: reclaimed %d stale in_flight claims\n", n)
				}
			}
		}
	}()

	wg.Wait()
}
