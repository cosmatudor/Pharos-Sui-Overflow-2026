package scanner

import (
	"context"
	"time"
)

// Market represents a single redeemable position on a settled oracle.
// IsRange distinguishes range positions (LowerStrike/HigherStrike) from
// binary positions (Strike/IsUp).
type Market struct {
	ID        string // composite key — unique per position type
	OracleID  string
	ManagerID string
	Trader    string // position owner — receives payout minus keeper tip
	ExpiryMs  uint64
	Quantity  uint64
	// Binary position fields (IsRange == false)
	Strike uint64
	IsUp   bool
	// Range position fields (IsRange == true)
	IsRange      bool
	LowerStrike  uint64
	HigherStrike uint64
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
					select {
					case out <- m:
					case <-ctx.Done():
						return
					}
				}
			}
		}
	}()

	return out
}
