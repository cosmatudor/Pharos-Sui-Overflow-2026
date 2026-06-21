package indexer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"keeper/internal/store"
)

const (
	PositionMintedType = "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138::predict::PositionMinted"
	RangeMintedType    = "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138::predict::RangeMinted"
	predictServerURL   = "https://predict-server.testnet.mystenlabs.com"
	pollInterval       = 2 * time.Second
	pageLimit          = 50
)

type Indexer struct {
	store  *store.Store
	rpcURL string
	http   *http.Client
}

func New(rpcURL string, st *store.Store) *Indexer {
	return &Indexer{
		store:  st,
		rpcURL: rpcURL,
		http:   &http.Client{Timeout: 15 * time.Second},
	}
}

// Run bootstraps both binary and range event streams, then polls every 2s.
func (idx *Indexer) Run(ctx context.Context) {
	count, err := idx.store.PositionCount(ctx)
	if err != nil {
		fmt.Printf("[indexer] count check error: %v\n", err)
	}
	if count == 0 {
		fmt.Println("[indexer] DB empty — scanning full event history...")
		if err := idx.drainHistory(ctx, PositionMintedType); err != nil {
			fmt.Printf("[indexer] history drain error (binary): %v\n", err)
		}
		if err := idx.drainHistory(ctx, RangeMintedType); err != nil {
			fmt.Printf("[indexer] history drain error (range): %v\n", err)
		}
		count, _ = idx.store.PositionCount(ctx)
		fmt.Printf("[indexer] history done: %d positions loaded\n", count)
	} else {
		fmt.Printf("[indexer] resuming from cursor (%d positions already indexed)\n", count)
	}

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := idx.poll(ctx, PositionMintedType); err != nil {
				fmt.Printf("[indexer] poll error (binary): %v\n", err)
			}
			if err := idx.poll(ctx, RangeMintedType); err != nil {
				fmt.Printf("[indexer] poll error (range): %v\n", err)
			}
		}
	}
}

// drainHistory fast-scans all historical events of the given type.
func (idx *Indexer) drainHistory(ctx context.Context, eventType string) error {
	var cursor interface{}
	var total int
	for {
		page, err := idx.queryEvents(ctx, eventType, cursor)
		if err != nil {
			return err
		}
		n, err := idx.processPage(ctx, eventType, page.Data)
		if err != nil {
			return err
		}
		total += n
		if !page.HasNextPage || page.NextCursor == nil {
			break
		}
		cursor = page.NextCursor
		_ = idx.store.SaveCursor(ctx, eventType, page.NextCursor.TxDigest, page.NextCursor.EventSeq)
	}
	fmt.Printf("[indexer] history (%s): %d events processed\n", eventType, total)
	return nil
}

// poll fetches new events of the given type since the last saved cursor.
func (idx *Indexer) poll(ctx context.Context, eventType string) error {
	txDigest, eventSeq := idx.store.GetCursor(ctx, eventType)
	var cursor interface{}
	if txDigest != "" && eventSeq != "" {
		cursor = &eventCursor{TxDigest: txDigest, EventSeq: eventSeq}
	}
	for {
		page, err := idx.queryEvents(ctx, eventType, cursor)
		if err != nil {
			return fmt.Errorf("query events: %w", err)
		}
		if len(page.Data) == 0 {
			break
		}
		if _, err := idx.processPage(ctx, eventType, page.Data); err != nil {
			return err
		}
		if !page.HasNextPage || page.NextCursor == nil {
			last := page.Data[len(page.Data)-1]
			_ = idx.store.SaveCursor(ctx, eventType, last.ID.TxDigest, last.ID.EventSeq)
			break
		}
		cursor = page.NextCursor
		_ = idx.store.SaveCursor(ctx, eventType, page.NextCursor.TxDigest, page.NextCursor.EventSeq)
	}
	return nil
}

// processPage upserts all events in a page into the DB.
func (idx *Indexer) processPage(ctx context.Context, eventType string, events []suiEvent) (int, error) {
	n := 0
	for _, evt := range events {
		var err error
		if eventType == RangeMintedType {
			var fields rangeMintedFields
			if err = json.Unmarshal(evt.ParsedJSON, &fields); err != nil {
				fmt.Printf("[indexer] parse range event %s: %v\n", evt.ID.TxDigest, err)
				continue
			}
			pos, convErr := fields.toRangePosition()
			if convErr != nil {
				fmt.Printf("[indexer] convert range event %s: %v\n", evt.ID.TxDigest, convErr)
				continue
			}
			err = idx.store.UpsertRangePosition(ctx, pos)
		} else {
			var fields mintedFields
			if err = json.Unmarshal(evt.ParsedJSON, &fields); err != nil {
				fmt.Printf("[indexer] parse event %s: %v\n", evt.ID.TxDigest, err)
				continue
			}
			pos, convErr := fields.toPosition()
			if convErr != nil {
				fmt.Printf("[indexer] convert event %s: %v\n", evt.ID.TxDigest, convErr)
				continue
			}
			err = idx.store.UpsertPosition(ctx, pos)
		}
		if err != nil {
			fmt.Printf("[indexer] upsert %s: %v\n", evt.ID.TxDigest, err)
			continue
		}
		n++
	}
	return n, nil
}

// ── RPC types ────────────────────────────────────────────────────────────────

type eventCursor struct {
	TxDigest string `json:"txDigest"`
	EventSeq string `json:"eventSeq"`
}

type suiEvent struct {
	ID struct {
		TxDigest string `json:"txDigest"`
		EventSeq string `json:"eventSeq"`
	} `json:"id"`
	ParsedJSON json.RawMessage `json:"parsedJson"`
}

type eventsPage struct {
	Data        []suiEvent   `json:"data"`
	NextCursor  *eventCursor `json:"nextCursor"`
	HasNextPage bool         `json:"hasNextPage"`
}

// PositionMinted event fields as returned by suix_queryEvents parsedJson.
// Numeric u64 fields come as quoted decimal strings.
type mintedFields struct {
	ManagerID string `json:"manager_id"`
	OracleID  string `json:"oracle_id"`
	Expiry    string `json:"expiry"`
	Strike    string `json:"strike"`
	IsUp      bool   `json:"is_up"`
	Quantity  string `json:"quantity"`
	Trader    string `json:"trader"`
}

func (f mintedFields) toPosition() (store.Position, error) {
	expiry, err := strconv.ParseUint(f.Expiry, 10, 64)
	if err != nil {
		return store.Position{}, fmt.Errorf("expiry: %w", err)
	}
	strike, err := strconv.ParseUint(f.Strike, 10, 64)
	if err != nil {
		return store.Position{}, fmt.Errorf("strike: %w", err)
	}
	qty, err := strconv.ParseUint(f.Quantity, 10, 64)
	if err != nil {
		return store.Position{}, fmt.Errorf("quantity: %w", err)
	}
	return store.Position{
		ManagerID: f.ManagerID,
		OracleID:  f.OracleID,
		Expiry:    expiry,
		Strike:    strike,
		IsUp:      f.IsUp,
		Quantity:  qty,
		Trader:    f.Trader,
	}, nil
}

// RangeMinted event fields.
type rangeMintedFields struct {
	ManagerID    string `json:"manager_id"`
	OracleID     string `json:"oracle_id"`
	Expiry       string `json:"expiry"`
	LowerStrike  string `json:"lower_strike"`
	HigherStrike string `json:"higher_strike"`
	Quantity     string `json:"quantity"`
	Trader       string `json:"trader"`
}

func (f rangeMintedFields) toRangePosition() (store.RangePosition, error) {
	expiry, err := strconv.ParseUint(f.Expiry, 10, 64)
	if err != nil {
		return store.RangePosition{}, fmt.Errorf("expiry: %w", err)
	}
	lower, err := strconv.ParseUint(f.LowerStrike, 10, 64)
	if err != nil {
		return store.RangePosition{}, fmt.Errorf("lower_strike: %w", err)
	}
	higher, err := strconv.ParseUint(f.HigherStrike, 10, 64)
	if err != nil {
		return store.RangePosition{}, fmt.Errorf("higher_strike: %w", err)
	}
	qty, err := strconv.ParseUint(f.Quantity, 10, 64)
	if err != nil {
		return store.RangePosition{}, fmt.Errorf("quantity: %w", err)
	}
	return store.RangePosition{
		ManagerID:    f.ManagerID,
		OracleID:     f.OracleID,
		Expiry:       expiry,
		LowerStrike:  lower,
		HigherStrike: higher,
		Quantity:     qty,
		Trader:       f.Trader,
	}, nil
}

// ── RPC helpers ──────────────────────────────────────────────────────────────

func (idx *Indexer) queryEvents(ctx context.Context, eventType string, cursor interface{}) (*eventsPage, error) {
	var page eventsPage
	err := idx.rpc(ctx, "suix_queryEvents", []interface{}{
		map[string]interface{}{"MoveEventType": eventType},
		cursor,    // nil = from beginning, or *eventCursor to resume
		pageLimit, // max events per page
		false,     // ascending order (oldest-first)
	}, &page)
	return &page, err
}

func (idx *Indexer) rpc(ctx context.Context, method string, params []interface{}, result interface{}) error {
	body, err := json.Marshal(map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  method,
		"params":  params,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, idx.rpcURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := idx.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	var envelope struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return err
	}
	if envelope.Error != nil {
		return fmt.Errorf("rpc %s: %s", method, envelope.Error.Message)
	}
	return json.Unmarshal(envelope.Result, result)
}
