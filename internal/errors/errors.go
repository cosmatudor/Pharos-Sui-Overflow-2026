package keepererrors

import "errors"

// ErrAlreadySettled is returned when the on-chain registry reports another
// keeper already settled this market. Treat as success, not failure.
var ErrAlreadySettled = errors.New("already settled by another keeper")

// ErrAlreadyRedeemed is returned when predict_manager aborts because the
// position no longer exists on-chain (stale predict-server data). Treat as
// settled — the position owner already received their payout.
var ErrAlreadyRedeemed = errors.New("position already redeemed on-chain")

// ErrInsufficientGas is returned when the keeper wallet doesn't have enough
// SUI to cover gas. Do not mark as permanently failed — retry after top-up.
var ErrInsufficientGas = errors.New("insufficient gas balance")
