package deepbook

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	keepererrors "keeper/internal/errors"
	"keeper/internal/scanner"
	"keeper/internal/store"

	"github.com/block-vision/sui-go-sdk/models"
	"github.com/block-vision/sui-go-sdk/signer"
	suiclient "github.com/block-vision/sui-go-sdk/sui"
	"github.com/block-vision/sui-go-sdk/transaction"
)

const (
	PredictPkg                  = "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138"
	PredictObjectID             = "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a"
	predictInitialSharedVersion = uint64(829857685)
	clockObjectID               = "0x6"
	clockInitialSharedVersion   = uint64(1)
	serverURL                   = "https://predict-server.testnet.mystenlabs.com"

	dUSDCAddress = "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a"
	dUSDCModule  = "dusdc"
	dUSDCName    = "DUSDC"
)

type Protocol struct {
	client    suiclient.ISuiAPI
	rawClient *suiclient.Client
	signer    *signer.Signer
	http      *http.Client
	rpcURL    string

	// On-chain registry coordinates.
	registryPkg  string // deployed keeper_registry package ID
	registryID   string // Registry shared object ID
	credentialID string // keeper's KeeperCredential owned object ID

	store Store

	isvCache        sync.Map // objectID -> initialSharedVersion
	managerTableIDs sync.Map // managerID -> positions Table object ID
	settleMu        sync.Mutex
}

// Store is the subset of store.Store used by the protocol layer.
type Store interface {
	ListActiveOracleIDs(ctx context.Context) ([]string, error)
	ListRedeemablePositions(ctx context.Context, oracleIDs []string) ([]store.Position, error)
}

func New(rpcURL, suiPrivKey, registryPkg, registryID, credentialID string, st Store) (*Protocol, error) {
	s, err := signer.NewSignerWithSecretKey(suiPrivKey)
	if err != nil {
		return nil, fmt.Errorf("load signer: %w", err)
	}
	iface := suiclient.NewSuiClient(rpcURL)
	raw := iface.(*suiclient.Client)
	return &Protocol{
		client:       iface,
		rawClient:    raw,
		signer:       s,
		http:         &http.Client{},
		rpcURL:       rpcURL,
		registryPkg:  registryPkg,
		registryID:   registryID,
		credentialID: credentialID,
		store:        st,
	}, nil
}

type apiOracle struct {
	OracleID        string  `json:"oracle_id"`
	Status          string  `json:"status"`
	SettlementPrice *uint64 `json:"settlement_price"`
}

func (p *Protocol) get(ctx context.Context, path string, out interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, serverURL+path, nil)
	if err != nil {
		return err
	}
	resp, err := p.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	return json.Unmarshal(body, out)
}

// FetchMarkets uses the local DB (populated by the indexer from PositionMinted events)
// to find candidate positions, then checks oracle settlement status with a single
// predict server API call. This replaces 691+ HTTP calls with 1 API call + 1 DB query.
func (p *Protocol) FetchMarkets(ctx context.Context) ([]scanner.Market, error) {
	// Step 1: get distinct oracle IDs that have positions in our DB.
	oracleIDs, err := p.store.ListActiveOracleIDs(ctx)
	if err != nil {
		return nil, fmt.Errorf("list oracle IDs: %w", err)
	}
	if len(oracleIDs) == 0 {
		fmt.Println("[scan] no positions in DB yet — indexer still syncing")
		return nil, nil
	}

	// Step 2: fetch oracle settlement status. One API call covers all oracles.
	var oracles []apiOracle
	if err := p.get(ctx, "/oracles", &oracles); err != nil {
		return nil, fmt.Errorf("fetch oracles: %w", err)
	}
	settledSet := make(map[string]bool, len(oracles))
	for _, o := range oracles {
		if o.Status == "settled" && o.SettlementPrice != nil {
			settledSet[o.OracleID] = true
		}
	}

	// Step 3: intersect — keep only oracle IDs we know about AND are settled.
	var settledOracleIDs []string
	for _, id := range oracleIDs {
		if settledSet[id] {
			settledOracleIDs = append(settledOracleIDs, id)
		}
	}
	if len(settledOracleIDs) == 0 {
		fmt.Printf("[scan] %d tracked oracles, none settled yet\n", len(oracleIDs))
		return nil, nil
	}

	// Step 4: query DB for positions on settled oracles, excluding already-settled markets.
	positions, err := p.store.ListRedeemablePositions(ctx, settledOracleIDs)
	if err != nil {
		return nil, fmt.Errorf("list redeemable positions: %w", err)
	}

	markets := make([]scanner.Market, 0, len(positions))
	for _, pos := range positions {
		id := pos.OracleID + "/" + pos.ManagerID + "/" +
			strconv.FormatUint(pos.Expiry, 10) + "/" +
			strconv.FormatUint(pos.Strike, 10) + "/" +
			strconv.FormatBool(pos.IsUp)
		markets = append(markets, scanner.Market{
			ID:        id,
			OracleID:  pos.OracleID,
			ManagerID: pos.ManagerID,
			Trader:    pos.Trader,
			ExpiryMs:  pos.Expiry,
			Strike:    pos.Strike,
			IsUp:      pos.IsUp,
			Quantity:  pos.Quantity,
		})
	}

	fmt.Printf("[scan] %d settled oracles, %d redeemable positions\n",
		len(settledOracleIDs), len(markets))
	return markets, nil
}

// initialSharedVersion fetches (and caches) the initial_shared_version for a shared object.
func (p *Protocol) initialSharedVersion(ctx context.Context, objectID string) (uint64, error) {
	if v, ok := p.isvCache.Load(objectID); ok {
		return v.(uint64), nil
	}
	resp, err := p.client.SuiGetObject(ctx, models.SuiGetObjectRequest{
		ObjectId: objectID,
		Options:  models.SuiObjectDataOptions{ShowOwner: true},
	})
	if err != nil {
		return 0, fmt.Errorf("get object %s: %w", objectID, err)
	}
	if resp.Data == nil {
		return 0, fmt.Errorf("object %s not found", objectID)
	}
	ownerBytes, err := json.Marshal(resp.Data.Owner)
	if err != nil {
		return 0, err
	}
	var owner models.ObjectOwner
	if err := json.Unmarshal(ownerBytes, &owner); err != nil {
		return 0, err
	}
	isv := owner.Shared.InitialSharedVersion
	p.isvCache.Store(objectID, isv)
	return isv, nil
}

// fetchOwnedObjectRef fetches the current version and digest of an owned object.
// Must be called fresh each time — owned objects change version after each mutation.
func (p *Protocol) fetchOwnedObjectRef(ctx context.Context, objectID string) (*transaction.SuiObjectRef, error) {
	resp, err := p.client.SuiGetObject(ctx, models.SuiGetObjectRequest{
		ObjectId: objectID,
		Options:  models.SuiObjectDataOptions{},
	})
	if err != nil {
		return nil, fmt.Errorf("get object %s: %w", objectID, err)
	}
	if resp.Data == nil {
		return nil, fmt.Errorf("object %s not found", objectID)
	}
	return transaction.NewSuiObjectRef(
		models.SuiAddress(resp.Data.ObjectId),
		resp.Data.Version,
		models.ObjectDigest(resp.Data.Digest),
	)
}

// sharedArg builds a fully-resolved shared object CallArg.
func sharedArg(objectID string, isv uint64, mutable bool) (transaction.CallArg, error) {
	addrBytes, err := transaction.ConvertSuiAddressStringToBytes(models.SuiAddress(objectID))
	if err != nil {
		return transaction.CallArg{}, err
	}
	return transaction.CallArg{
		Object: &transaction.ObjectArg{
			SharedObject: &transaction.SharedObjectRef{
				ObjectId:             *addrBytes,
				InitialSharedVersion: isv,
				Mutable:              mutable,
			},
		},
	}, nil
}

// dUSDCTypeTag builds the TypeTag for the dUSDC coin type.
func dUSDCTypeTag() (transaction.TypeTag, error) {
	addrBytes, err := transaction.ConvertSuiAddressStringToBytes(models.SuiAddress(dUSDCAddress))
	if err != nil {
		return transaction.TypeTag{}, fmt.Errorf("parse dUSDC address: %w", err)
	}
	return transaction.TypeTag{
		Struct: &transaction.StructTag{
			Address:    *addrBytes,
			Module:     dUSDCModule,
			Name:       dUSDCName,
			TypeParams: []*transaction.TypeTag{},
		},
	}, nil
}

// suiRPC executes a raw JSON-RPC call against the Sui fullnode.
// Used for RPC methods not yet wrapped by the SDK (e.g. suix_getDynamicFieldObject).
func (p *Protocol) suiRPC(ctx context.Context, method string, params []interface{}, result interface{}) error {
	body, err := json.Marshal(map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  method,
		"params":  params,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.rpcURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.http.Do(req)
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

// resolvePositionsTableID fetches and caches the object ID of the positions Table
// inside a PredictManager. Table IDs are stable for the lifetime of the object.
func (p *Protocol) resolvePositionsTableID(ctx context.Context, managerID string) (string, error) {
	if v, ok := p.managerTableIDs.Load(managerID); ok {
		return v.(string), nil
	}
	resp, err := p.client.SuiGetObject(ctx, models.SuiGetObjectRequest{
		ObjectId: managerID,
		Options:  models.SuiObjectDataOptions{ShowContent: true},
	})
	if err != nil {
		return "", fmt.Errorf("get manager %s: %w", managerID, err)
	}
	if resp.Data == nil || resp.Data.Content == nil {
		return "", fmt.Errorf("manager %s has no content", managerID)
	}
	contentBytes, err := json.Marshal(resp.Data.Content)
	if err != nil {
		return "", err
	}
	var content struct {
		Fields struct {
			Positions struct {
				Fields struct {
					ID struct {
						ID string `json:"id"`
					} `json:"id"`
				} `json:"fields"`
			} `json:"positions"`
		} `json:"fields"`
	}
	if err := json.Unmarshal(contentBytes, &content); err != nil {
		return "", fmt.Errorf("parse manager content: %w", err)
	}
	tableID := content.Fields.Positions.Fields.ID.ID
	if tableID == "" {
		return "", fmt.Errorf("positions table ID empty for manager %s", managerID)
	}
	p.managerTableIDs.Store(managerID, tableID)
	return tableID, nil
}

// marketKeyDirection converts the API's is_up bool to the on-chain MarketKey
// direction u8. The Move contract stores direction: u8 where 0 = UP, 1 = DOWN —
// the inverse of what you might expect.
func marketKeyDirection(isUp bool) uint8 {
	if isUp {
		return 0
	}
	return 1
}

// onChainQty returns the actual remaining quantity stored on-chain for this
// position. Returns 0 if the position doesn't exist, has been fully redeemed
// (value == 0 but entry persists), or the table entry was removed.
//
// Also returns the on-chain quantity to use in the PTB so we never pass a
// stale API quantity that diverges from what the contract actually holds.
//
// Fails open: any RPC/parse error → returns m.Quantity (API value) so the PTB
// remains the authoritative check.
func (p *Protocol) onChainQty(ctx context.Context, m scanner.Market) uint64 {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	tableID, err := p.resolvePositionsTableID(ctx, m.ManagerID)
	if err != nil {
		fmt.Printf("[precheck] manager=%s table resolve error: %v → fail open (api qty=%d)\n",
			m.ManagerID, err, m.Quantity)
		return m.Quantity // fail open
	}

	var result struct {
		Error *struct {
			Code string `json:"code"`
		} `json:"error"`
		Data *struct {
			Content *struct {
				Fields *struct {
					Value string `json:"value"` // u64 as quoted decimal string
				} `json:"fields"`
			} `json:"content"`
		} `json:"data"`
	}
	err = p.suiRPC(ctx, "suix_getDynamicFieldObject", []interface{}{
		tableID,
		map[string]interface{}{
			"type": PredictPkg + "::market_key::MarketKey",
			"value": map[string]interface{}{
				"oracle_id": m.OracleID,
				"expiry":    strconv.FormatUint(m.ExpiryMs, 10),
				"strike":    strconv.FormatUint(m.Strike, 10),
				"direction": marketKeyDirection(m.IsUp),
			},
		},
	}, &result)
	if err != nil {
		fmt.Printf("[precheck] oracle=%s strike=%d isUp=%v rpc error: %v → fail open (api qty=%d)\n",
			m.OracleID, m.Strike, m.IsUp, err, m.Quantity)
		return m.Quantity // RPC failure → fail open
	}

	// Field not found — position fully removed from table.
	if result.Error != nil {
		return 0
	}

	// Parse the on-chain u64 quantity from the dynamic field value.
	if result.Data == nil || result.Data.Content == nil || result.Data.Content.Fields == nil {
		fmt.Printf("[precheck] oracle=%s unexpected response shape → fail open\n", m.OracleID)
		return m.Quantity // unexpected shape → fail open
	}
	qty, err := strconv.ParseUint(result.Data.Content.Fields.Value, 10, 64)
	if err != nil {
		fmt.Printf("[precheck] oracle=%s qty parse error: %v → fail open\n", m.OracleID, err)
		return m.Quantity // parse failure → fail open
	}

	return qty
}

// isAlreadySettledError reports whether a Sui effects error string represents
// a MoveAbort from registry::EAlreadySettled (abort code 0).
func isAlreadySettledError(effectsErr string) bool {
	return strings.Contains(effectsErr, `"registry"`) &&
		strings.Contains(effectsErr, ", 0)")
}

// isAlreadyRedeemedError detects a MoveAbort from predict_manager::decrease_position
// (abort code 1) — the position no longer exists on-chain, predict-server data is stale.
// Handles both decimal ", 1)" (effects status) and hex "0x1)" (dry-run error) formats.
func isAlreadyRedeemedError(effectsErr string) bool {
	return strings.Contains(effectsErr, "predict_manager") &&
		strings.Contains(effectsErr, "decrease_position") &&
		(strings.Contains(effectsErr, ", 1)") || strings.Contains(effectsErr, "0x1)"))
}

// isGasError detects an insufficient gas balance error from the RPC layer.
func isGasError(errStr string) bool {
	return strings.Contains(errStr, "Balance of gas object") &&
		strings.Contains(errStr, "is lower than the needed amount")
}

// Settle executes a 3-step PTB per market:
//  1. market_key::new           → MarketKey
//  2. predict::redeem_permissionless  → payout to position owner's manager
//  3. registry::record_settlement    → on-chain idempotency + keeper reward
//
// Returns keepererrors.ErrAlreadySettled if another keeper already settled this
// market — the caller should treat this as success, not failure.
func (p *Protocol) Settle(ctx context.Context, m scanner.Market) (string, error) {
	// Pre-check: read the actual on-chain quantity before acquiring the mutex.
	// Runs concurrently across all workers — no lock held.
	// Returns 0 if the position is gone or zero-balanced (entry persists but qty=0).
	// Fails open on RPC error: uses the API quantity so the PTB remains authoritative.
	qty := p.onChainQty(ctx, m)
	if qty == 0 {
		return "", keepererrors.ErrAlreadyRedeemed
	}

	p.settleMu.Lock()
	defer p.settleMu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	// Use the verified on-chain quantity — never the stale API value.
	m.Quantity = qty

	fmt.Printf("[ptb] START oracle=%s manager=%s expiry=%d strike=%d isUp=%v qty=%d trader=%s\n",
		m.OracleID, m.ManagerID, m.ExpiryMs, m.Strike, m.IsUp, m.Quantity, m.Trader)

	// Resolve ISVs for shared objects.
	registryISV, err := p.initialSharedVersion(ctx, p.registryID)
	if err != nil {
		return "", fmt.Errorf("registry ISV: %w", err)
	}
	oracleISV, err := p.initialSharedVersion(ctx, m.OracleID)
	if err != nil {
		return "", fmt.Errorf("oracle ISV: %w", err)
	}
	managerISV, err := p.initialSharedVersion(ctx, m.ManagerID)
	if err != nil {
		return "", fmt.Errorf("manager ISV: %w", err)
	}

	// Build shared object args.
	registryArg, err := sharedArg(p.registryID, registryISV, true)
	if err != nil {
		return "", err
	}
	predictArg, err := sharedArg(PredictObjectID, predictInitialSharedVersion, true)
	if err != nil {
		return "", err
	}
	managerArg, err := sharedArg(m.ManagerID, managerISV, true)
	if err != nil {
		return "", err
	}
	oracleArg, err := sharedArg(m.OracleID, oracleISV, false)
	if err != nil {
		return "", err
	}
	clockArg, err := sharedArg(clockObjectID, clockInitialSharedVersion, false)
	if err != nil {
		return "", err
	}

	// Fetch credential ref fresh — it changes version after each settlement.
	credRef, err := p.fetchOwnedObjectRef(ctx, p.credentialID)
	if err != nil {
		return "", fmt.Errorf("fetch credential: %w", err)
	}
	credArg := transaction.CallArg{
		Object: &transaction.ObjectArg{
			ImmOrOwnedObject: credRef,
		},
	}

	typeTag, err := dUSDCTypeTag()
	if err != nil {
		return "", err
	}

	// Fetch gas coin.
	coinsResp, err := p.client.SuiXGetCoins(ctx, models.SuiXGetCoinsRequest{
		Owner:    p.signer.Address,
		CoinType: "0x2::sui::SUI",
		Limit:    1,
	})
	if err != nil {
		return "", fmt.Errorf("fetch gas coins: %w", err)
	}
	if len(coinsResp.Data) == 0 {
		return "", fmt.Errorf("no SUI coins for gas")
	}
	gasRef, err := transaction.NewSuiObjectRef(
		models.SuiAddress(coinsResp.Data[0].CoinObjectId),
		coinsResp.Data[0].Version,
		models.ObjectDigest(coinsResp.Data[0].Digest),
	)
	if err != nil {
		return "", fmt.Errorf("build gas ref: %w", err)
	}

	tx := transaction.NewTransaction()
	tx.SetSigner(p.signer)
	tx.SetSuiClient(p.rawClient)
	tx.SetGasBudget(50_000_000)
	tx.SetGasPayment([]transaction.SuiObjectRef{*gasRef})

	predictPkg := models.SuiAddress(PredictPkg)
	registryPkg := models.SuiAddress(p.registryPkg)

	// Step 1: build MarketKey.
	key := tx.MoveCall(predictPkg, "market_key", "new",
		[]transaction.TypeTag{},
		[]transaction.Argument{
			tx.Pure(m.OracleID),
			tx.Pure(m.ExpiryMs),
			tx.Pure(m.Strike),
			tx.Pure(m.IsUp),
		},
	)

	// Step 2: redeem the position — payout flows to the position owner's manager.
	tx.MoveCall(predictPkg, "predict", "redeem_permissionless",
		[]transaction.TypeTag{typeTag},
		[]transaction.Argument{
			tx.Object(predictArg),
			tx.Object(managerArg),
			tx.Object(oracleArg),
			key,
			tx.Pure(m.Quantity),
			tx.Object(clockArg),
		},
	)

	// Step 3: record settlement on-chain — idempotency guard + keeper reward.
	// PTB atomicity guarantees this only executes if step 2 succeeded.
	tx.MoveCall(registryPkg, "registry", "record_settlement",
		[]transaction.TypeTag{},
		[]transaction.Argument{
			tx.Object(registryArg),
			tx.Object(credArg),
			tx.Pure(m.OracleID),
			tx.Pure(m.ManagerID),
			tx.Pure(m.ExpiryMs),
			tx.Pure(m.Strike),
			tx.Pure(m.IsUp),
			tx.Object(clockArg),
		},
	)

	rsp, err := tx.Execute(ctx, models.SuiTransactionBlockOptions{
		ShowEffects: true,
	}, "WaitForLocalExecution")
	if err != nil {
		errStr := err.Error()
		fmt.Printf("[ptb] execute error: %v\n", err)
		if isGasError(errStr) {
			return "", keepererrors.ErrInsufficientGas
		}
		if isAlreadyRedeemedError(errStr) {
			return "", keepererrors.ErrAlreadyRedeemed
		}
		if isAlreadySettledError(errStr) {
			return "", keepererrors.ErrAlreadySettled
		}
		return "", fmt.Errorf("execute ptb: %w", err)
	}
	if rsp.Effects.Status.Status != "success" {
		fmt.Printf("[ptb] FAILED effects_error=%s\n", rsp.Effects.Status.Error)
		if isAlreadySettledError(rsp.Effects.Status.Error) {
			return "", keepererrors.ErrAlreadySettled
		}
		if isAlreadyRedeemedError(rsp.Effects.Status.Error) {
			return "", keepererrors.ErrAlreadyRedeemed
		}
		return "", fmt.Errorf("ptb failed on chain: %s", rsp.Effects.Status.Error)
	}

	fmt.Printf("[ptb] SUCCESS tx=%s\n", rsp.Digest)
	return rsp.Digest, nil
}
