package deepbook

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	keepererrors "keeper/internal/errors"
	"keeper/internal/scanner"

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

	// On-chain registry coordinates.
	registryPkg  string // deployed keeper_registry package ID
	registryID   string // Registry shared object ID
	credentialID string // keeper's KeeperCredential owned object ID

	isvCache sync.Map
	settleMu sync.Mutex // serializes PTB execution so gas coin version stays fresh
}

func New(rpcURL, suiPrivKey, registryPkg, registryID, credentialID string) (*Protocol, error) {
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
		registryPkg:  registryPkg,
		registryID:   registryID,
		credentialID: credentialID,
	}, nil
}

type apiOracle struct {
	OracleID        string  `json:"oracle_id"`
	Status          string  `json:"status"`
	SettlementPrice *uint64 `json:"settlement_price"`
}

type apiManager struct {
	ManagerID string `json:"manager_id"`
}

type apiPositions struct {
	Minted   []apiPosition `json:"minted"`
	Redeemed []apiPosition `json:"redeemed"`
}

type apiPosition struct {
	OracleID  string `json:"oracle_id"`
	ManagerID string `json:"manager_id"`
	Trader    string `json:"trader"`
	Expiry    uint64 `json:"expiry"`
	Strike    uint64 `json:"strike"`
	IsUp      bool   `json:"is_up"`
	Quantity  uint64 `json:"quantity"`
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

// FetchMarkets queries the predict server for settled oracles with unredeemed positions.
func (p *Protocol) FetchMarkets(ctx context.Context) ([]scanner.Market, error) {
	var oracles []apiOracle
	if err := p.get(ctx, "/oracles", &oracles); err != nil {
		return nil, fmt.Errorf("fetch oracles: %w", err)
	}
	if raw, err := json.MarshalIndent(oracles, "", "  "); err == nil {
		_ = os.WriteFile("oracles.json", raw, 0644)
	}

	settled := make(map[string]bool)
	for _, o := range oracles {
		if o.Status == "settled" && o.SettlementPrice != nil {
			settled[o.OracleID] = true
		}
	}
	fmt.Printf("settled oracles: %d / %d\n", len(settled), len(oracles))

	var managers []apiManager
	if err := p.get(ctx, "/managers", &managers); err != nil {
		return nil, fmt.Errorf("fetch managers: %w", err)
	}

	var markets []scanner.Market
	for _, mgr := range managers {
		var pos apiPositions
		if err := p.get(ctx, "/managers/"+mgr.ManagerID+"/positions", &pos); err != nil {
			continue
		}
		if len(pos.Minted) == 0 {
			continue
		}

		type posKey struct {
			oracleID string
			expiry   uint64
			strike   uint64
			isUp     bool
		}
		redeemedCount := make(map[posKey]int)
		for _, r := range pos.Redeemed {
			redeemedCount[posKey{r.OracleID, r.Expiry, r.Strike, r.IsUp}]++
		}

		for _, mp := range pos.Minted {
			if !settled[mp.OracleID] {
				continue
			}
			k := posKey{mp.OracleID, mp.Expiry, mp.Strike, mp.IsUp}
			if redeemedCount[k] > 0 {
				redeemedCount[k]--
				continue
			}
			id := mp.OracleID + "/" + mgr.ManagerID + "/" +
				strconv.FormatUint(mp.Expiry, 10) + "/" +
				strconv.FormatUint(mp.Strike, 10) + "/" +
				strconv.FormatBool(mp.IsUp)
			markets = append(markets, scanner.Market{
				ID:        id,
				OracleID:  mp.OracleID,
				ManagerID: mgr.ManagerID,
				Trader:    mp.Trader,
				ExpiryMs:  mp.Expiry,
				Strike:    mp.Strike,
				IsUp:      mp.IsUp,
				Quantity:  mp.Quantity,
			})
		}
	}

	fmt.Printf("redeemable positions: %d\n", len(markets))
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

// isAlreadySettledError reports whether a Sui effects error string represents
// a MoveAbort from registry::EAlreadySettled (abort code 0).
func isAlreadySettledError(effectsErr string) bool {
	return strings.Contains(effectsErr, `"registry"`) &&
		strings.Contains(effectsErr, ", 0)")
}

// isAlreadyRedeemedError detects a MoveAbort from predict_manager::decrease_position
// (abort code 1) — the position no longer exists on-chain, predict-server data is stale.
func isAlreadyRedeemedError(effectsErr string) bool {
	return strings.Contains(effectsErr, `"predict_manager"`) &&
		strings.Contains(effectsErr, "decrease_position") &&
		strings.Contains(effectsErr, ", 1)")
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
	p.settleMu.Lock()
	defer p.settleMu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

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
		if isGasError(errStr) {
			return "", keepererrors.ErrInsufficientGas
		}
		return "", fmt.Errorf("execute ptb: %w", err)
	}
	if rsp.Effects.Status.Status != "success" {
		if isAlreadySettledError(rsp.Effects.Status.Error) {
			return "", keepererrors.ErrAlreadySettled
		}
		if isAlreadyRedeemedError(rsp.Effects.Status.Error) {
			return "", keepererrors.ErrAlreadyRedeemed
		}
		return "", fmt.Errorf("ptb failed on chain: %s", rsp.Effects.Status.Error)
	}

	return rsp.Digest, nil
}
