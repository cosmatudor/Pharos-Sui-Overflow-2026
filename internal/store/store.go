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

// Position is a minted predict position discovered via on-chain events.
type Position struct {
	ManagerID string
	OracleID  string
	Expiry    uint64
	Strike    uint64
	IsUp      bool
	Quantity  uint64
	Trader    string
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
		);

		CREATE TABLE IF NOT EXISTS positions (
			manager_id TEXT    NOT NULL,
			oracle_id  TEXT    NOT NULL,
			expiry     BIGINT  NOT NULL,
			strike     BIGINT  NOT NULL,
			is_up      BOOLEAN NOT NULL,
			quantity   BIGINT  NOT NULL,
			trader     TEXT    NOT NULL,
			PRIMARY KEY (manager_id, oracle_id, expiry, strike, is_up)
		);

		CREATE TABLE IF NOT EXISTS event_cursors (
			event_type TEXT PRIMARY KEY,
			tx_digest  TEXT NOT NULL,
			event_seq  TEXT NOT NULL
		);
	`)
	return err
}

// UpsertPosition inserts or updates a position from a PositionMinted event.
// Quantity is additive: multiple mints for the same key accumulate.
func (s *Store) UpsertPosition(ctx context.Context, p Position) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO positions (manager_id, oracle_id, expiry, strike, is_up, quantity, trader)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (manager_id, oracle_id, expiry, strike, is_up)
		DO UPDATE SET quantity = positions.quantity + EXCLUDED.quantity
	`, p.ManagerID, p.OracleID, p.Expiry, p.Strike, p.IsUp, p.Quantity, p.Trader)
	return err
}

// ListActiveOracleIDs returns distinct oracle IDs with positions expiring within
// the last 48 h (catches oracles that may have settled recently).
func (s *Store) ListActiveOracleIDs(ctx context.Context) ([]string, error) {
	cutoff := time.Now().UnixMilli() - 48*3_600_000
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT oracle_id FROM positions WHERE expiry > $1
	`, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ListRedeemablePositions returns positions for the given settled oracle IDs
// whose market ID is not already settled or in-flight in the markets table.
// Market ID format: oracleID/managerID/expiry/strike/isUp (matches FetchMarkets output).
func (s *Store) ListRedeemablePositions(ctx context.Context, oracleIDs []string) ([]Position, error) {
	if len(oracleIDs) == 0 {
		return nil, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT p.manager_id, p.oracle_id, p.expiry, p.strike, p.is_up, p.quantity, p.trader
		FROM positions p
		WHERE p.oracle_id = ANY($1)
		  AND NOT EXISTS (
		    SELECT 1 FROM markets m
		    WHERE m.id = p.oracle_id || '/' || p.manager_id || '/' ||
		                 p.expiry::text || '/' || p.strike::text || '/' || p.is_up::text
		      AND m.status IN ('settled', 'in_flight')
		  )
	`, oracleIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Position
	for rows.Next() {
		var p Position
		if err := rows.Scan(&p.ManagerID, &p.OracleID, &p.Expiry, &p.Strike, &p.IsUp, &p.Quantity, &p.Trader); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ListPositionsByOracle returns all positions for a given oracle.
func (s *Store) ListPositionsByOracle(ctx context.Context, oracleID string) ([]Position, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT manager_id, oracle_id, expiry, strike, is_up, quantity, trader
		FROM positions WHERE oracle_id = $1
	`, oracleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Position
	for rows.Next() {
		var p Position
		if err := rows.Scan(&p.ManagerID, &p.OracleID, &p.Expiry, &p.Strike, &p.IsUp, &p.Quantity, &p.Trader); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// PositionCount returns how many positions are in the DB.
func (s *Store) PositionCount(ctx context.Context) (int64, error) {
	var n int64
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM positions`).Scan(&n)
	return n, err
}

// GetCursor returns the last seen event cursor for an event type.
// Returns empty strings if no cursor stored yet.
func (s *Store) GetCursor(ctx context.Context, eventType string) (txDigest, eventSeq string) {
	_ = s.pool.QueryRow(ctx, `
		SELECT tx_digest, event_seq FROM event_cursors WHERE event_type = $1
	`, eventType).Scan(&txDigest, &eventSeq)
	return
}

// SaveCursor persists an event cursor.
func (s *Store) SaveCursor(ctx context.Context, eventType, txDigest, eventSeq string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO event_cursors (event_type, tx_digest, event_seq)
		VALUES ($1, $2, $3)
		ON CONFLICT (event_type) DO UPDATE SET tx_digest = EXCLUDED.tx_digest, event_seq = EXCLUDED.event_seq
	`, eventType, txDigest, eventSeq)
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
