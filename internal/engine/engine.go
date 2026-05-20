package engine

import (
	"context"
	"fmt"
	"keeper/internal/queue"
	"keeper/internal/scanner"
	"keeper/internal/settler"
	"sync"
)

type Engine struct {
	scanner *scanner.Scanner
	queue   queue.Queue
	settler *settler.Settler
}

func New(s *scanner.Scanner, q queue.Queue, st *settler.Settler) *Engine {
	return &Engine{
		scanner: s,
		queue:   q,
		settler: st,
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

	wg.Wait()
}
