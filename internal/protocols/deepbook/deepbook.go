package deepbook

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"keeper/internal/scanner"

	"github.com/block-vision/sui-go-sdk/models"
	"github.com/block-vision/sui-go-sdk/signer"
	suiclient "github.com/block-vision/sui-go-sdk/sui"
)

const (
	PredictPkg      = "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138"
	PredictObjectID = "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a"
	dUSDCType       = "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC"

	positionMintedEvent = PredictPkg + "::predict::PositionMinted"
)

type Protocol struct {
	client suiclient.ISuiAPI
	signer *signer.Signer
}

func New(rpcURL, suiPrivKey string) (*Protocol, error) {
	s, err := signer.NewSignerWithSecretKey(suiPrivKey)
	if err != nil {
		return nil, fmt.Errorf("load signer: %w", err)
	}
	return &Protocol{
		client: suiclient.NewSuiClient(rpcURL),
		signer: s,
	}, nil
}

// FetchMarkets discovers oracle IDs via PositionMinted events, then fetches
// each OracleSVI object and returns ones that are expired and unsettled.
func (p *Protocol) FetchMarkets(ctx context.Context) ([]scanner.Market, error) {
	rsp, err := p.client.SuiXQueryEvents(ctx, models.SuiXQueryEventsRequest{
		SuiEventFilter: map[string]interface{}{
			"MoveEventType": positionMintedEvent,
		},
		Limit:           50,
		DescendingOrder: false,
	})
	if err != nil {
		return nil, fmt.Errorf("query PositionMinted events: %w", err)
	}

	// deduplicate oracle IDs
	seen := make(map[string]bool)
	var oracleIDs []string
	for _, event := range rsp.Data {
		id, ok := event.ParsedJson["oracle_id"].(string)
		if !ok || seen[id] {
			continue
		}
		seen[id] = true
		oracleIDs = append(oracleIDs, id)
	}

	fmt.Printf("found %d unique oracle IDs from events\n", len(oracleIDs))

	nowMs := time.Now().UnixMilli()
	var markets []scanner.Market

	for _, id := range oracleIDs {
		obj, err := p.client.SuiGetObject(ctx, models.SuiGetObjectRequest{
			ObjectId: id,
			Options: models.SuiObjectDataOptions{
				ShowContent: true,
			},
		})
		if err != nil {
			fmt.Printf("fetch oracle %s: %v\n", id, err)
			continue
		}

		if obj.Data == nil || obj.Data.Content == nil {
			continue
		}

		fields := obj.Data.Content.Fields

		expiryStr, _ := fields["expiry"].(string)
		expiryMs, err := strconv.ParseInt(expiryStr, 10, 64)
		if err != nil {
			continue
		}

		// settlement_price is Option<u64>: nil means None (unsettled)
		settled := fields["settlement_price"] != nil

		fmt.Printf("oracle %s — expiry: %s, settled: %v\n", id, time.UnixMilli(expiryMs).Format(time.RFC3339), settled)

		if expiryMs < nowMs && !settled {
			fmt.Printf("  → expired and unsettled, queuing for settlement\n")
			markets = append(markets, scanner.Market{
				ID:         id,
				ExpiryTime: time.UnixMilli(expiryMs),
				Settled:    false,
				Type:       "binary",
			})
		}
	}

	return markets, nil
}

// Settle calls redeem_permissionless for a settled oracle.
// Note: the oracle must already have settlement_price set by an authorized party.
func (p *Protocol) Settle(ctx context.Context, m scanner.Market) (string, error) {
	rsp, err := p.client.MoveCall(ctx, models.MoveCallRequest{
		Signer:          p.signer.Address,
		PackageObjectId: PredictPkg,
		Module:          "predict",
		Function:        "redeem_permissionless",
		TypeArguments:   []interface{}{dUSDCType},
		Arguments: []interface{}{
			PredictObjectID,
			m.ID,
		},
		GasBudget: "10000000",
	})
	if err != nil {
		return "", fmt.Errorf("move call: %w", err)
	}

	result, err := p.client.SignAndExecuteTransactionBlock(ctx, models.SignAndExecuteTransactionBlockRequest{
		TxnMetaData: rsp,
		PriKey:      p.signer.PriKey,
		RequestType: "WaitForLocalExecution",
	})
	if err != nil {
		return "", fmt.Errorf("execute tx: %w", err)
	}

	return result.Digest, nil
}
