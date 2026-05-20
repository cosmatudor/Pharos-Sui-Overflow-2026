package scanner

import (
	"context"
	"time"
)

type Market struct {
	ID          string
	ExpiryTime  time.Time
	Settled     bool
	StrikePrice float64
	Type        string // "binary" or "range"
}

// Protocol is the chain-specific layer. The deepbook package will implement this.
type Protocol interface {
	FetchMarkets(ctx context.Context) ([]Market, error)
}

type Scanner struct {
	protocol Protocol
	interval time.Duration
}

func New(protocol Protocol, interval time.Duration) *Scanner {
	return &Scanner{
		protocol: protocol,
		interval: interval,
	}
}

// Start polls the chain on each tick and emits expired, unsettled markets.
// Closes the returned channel when ctx is cancelled.
func (s *Scanner) Start(ctx context.Context) <-chan Market {
	out := make(chan Market)

	go func() {
		defer close(out)

		ticker := time.NewTicker(s.interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				markets, err := s.protocol.FetchMarkets(ctx)
				if err != nil {
					continue
				}
				for _, m := range markets {
					if m.ExpiryTime.Before(time.Now()) && !m.Settled {
						select {
						case out <- m:
						case <-ctx.Done():
							return
						}
					}
				}
			}
		}
	}()

	return out
}
