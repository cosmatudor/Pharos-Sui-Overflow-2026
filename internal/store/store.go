package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool *pgxpool.Pool
}

func New(ctx context.Context, connString string) (*Store, error) {
	pool, err := pgxpool.New(ctx, connString)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, err
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Migrate(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS markets (
			id             TEXT PRIMARY KEY,
			status         TEXT NOT NULL,
			tx_hash        TEXT,
			failure_reason TEXT,
			created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	return err
}

func (s *Store) IsSettled(ctx context.Context, marketID string) (bool, error) {
	var status string
	err := s.pool.QueryRow(ctx, `SELECT status FROM markets WHERE id = $1`, marketID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return status == "settled", nil
}

// MarkInFlight attempts to claim a market for processing.
// Returns claimed=false (no error) if another worker already claimed it.
func (s *Store) MarkInFlight(ctx context.Context, marketID string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO markets (id, status)
		VALUES ($1, 'in_flight')
		ON CONFLICT (id) DO UPDATE
			SET status = 'in_flight', updated_at = NOW()
			WHERE markets.status = 'failed'
	`, marketID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (s *Store) MarkSettled(ctx context.Context, marketID string, txHash string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE markets SET status = 'settled', tx_hash = $2, updated_at = NOW()
		WHERE id = $1
	`, marketID, txHash)
	return err
}

func (s *Store) MarkFailed(ctx context.Context, marketID string, reason string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE markets SET status = 'failed', failure_reason = $2, updated_at = NOW()
		WHERE id = $1
	`, marketID, reason)
	return err
}

// ReclaimStale resets in_flight claims that haven't been updated within olderThan
// back to failed, so another keeper instance can retry them.
func (s *Store) ReclaimStale(ctx context.Context, olderThan time.Duration) (int64, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE markets
		SET status = 'failed', failure_reason = 'stale_in_flight', updated_at = NOW()
		WHERE status = 'in_flight' AND updated_at < NOW() - $1::interval
	`, olderThan)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
