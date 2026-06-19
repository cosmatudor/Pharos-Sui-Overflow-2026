// Copyright (c) Keeper Network
// SPDX-License-Identifier: Apache-2.0

/// Registry — on-chain coordination layer for the DeepBook Predict keeper network.
///
/// Security model: the keeper calls predict::redeem_permissionless in step N of
/// a PTB and record_settlement in step N+1. PTB atomicity guarantees step N+1
/// only executes if step N succeeded — a keeper cannot collect a reward without
/// a genuine redemption in the same transaction.
module keeper_registry::registry;

use keeper_registry::credential::{Self, KeeperCredential};
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::Coin;
use sui::event;
use sui::sui::SUI;
use sui::table::{Self, Table};

// === Errors ===
const EAlreadySettled: u64 = 0;
const EInsufficientTreasury: u64 = 1;

// === Events ===

/// Emitted on every successful settlement recorded in the registry.
/// Off-chain dashboards subscribe to this event type to build the live feed.
public struct SettlementRecorded has copy, drop {
    keeper: address,
    oracle_id: address,
    manager_id: address,
    expiry: u64,
    strike: u64,
    is_up: bool,
    reward_paid: u64,
}

// === Structs ===

/// Uniquely identifies one manager's redeemable position.
/// Mirrors DeepBook Predict's MarketKey fields without a compile-time
/// dependency on the deepbook_predict package.
public struct SettlementKey has copy, drop, store {
    oracle_id: address,
    manager_id: address,
    expiry: u64,
    strike: u64,
    is_up: bool,
}

/// Shared object — one per deployment.
public struct Registry has key {
    id: UID,
    /// keeper address that settled each market. Primary idempotency guard.
    settled_markets: Table<SettlementKey, address>,
    /// SUI reward paid per successful settlement (MIST).
    reward_per_settlement: u64,
    /// Treasury funded by the protocol or community.
    treasury: Balance<SUI>,
}

/// Owned by the deployer; required for admin operations.
public struct AdminCap has key, store { id: UID }

// === Init ===

fun init(ctx: &mut TxContext) {
    transfer::share_object(Registry {
        id: object::new(ctx),
        settled_markets: table::new(ctx),
        reward_per_settlement: 100_000_000, // 0.1 SUI default
        treasury: balance::zero(),
    });
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

// === Core: Record Settlement ===

#[allow(lint(self_transfer))]
/// Record that this keeper settled a DeepBook Predict position and pay the reward.
///
/// MUST be called after predict::redeem_permissionless in the same PTB.
/// PTB atomicity ensures this only executes if the redemption succeeded.
///
/// Reverts with EAlreadySettled (code 0) if another keeper already settled —
/// the off-chain keeper should treat this as a graceful race loss, not a failure.
public fun record_settlement(
    registry: &mut Registry,
    cred: &mut KeeperCredential,
    oracle_id: address,
    manager_id: address,
    expiry: u64,
    strike: u64,
    is_up: bool,
    clk: &Clock,
    ctx: &mut TxContext,
) {
    credential::assert_active(cred, clk, ctx);

    let key = SettlementKey { oracle_id, manager_id, expiry, strike, is_up };
    assert!(!registry.settled_markets.contains(key), EAlreadySettled);

    registry.settled_markets.add(key, ctx.sender());
    credential::increment_jobs(cred);

    // Pay from treasury if funded. Settlement is recorded even when empty.
    let reward_paid = if (registry.treasury.value() >= registry.reward_per_settlement) {
        let reward = registry.treasury.split(registry.reward_per_settlement);
        transfer::public_transfer(reward.into_coin(ctx), ctx.sender());
        registry.reward_per_settlement
    } else {
        0
    };

    event::emit(SettlementRecorded {
        keeper: ctx.sender(),
        oracle_id,
        manager_id,
        expiry,
        strike,
        is_up,
        reward_paid,
    });
}

// === Treasury Management ===

/// Anyone can top up the treasury.
public fun fund_treasury(registry: &mut Registry, coin: Coin<SUI>) {
    registry.treasury.join(coin.into_balance());
}

/// Admin: withdraw treasury funds.
public fun withdraw_treasury(
    _: &AdminCap,
    registry: &mut Registry,
    amount: u64,
    ctx: &mut TxContext,
): Coin<SUI> {
    assert!(registry.treasury.value() >= amount, EInsufficientTreasury);
    registry.treasury.split(amount).into_coin(ctx)
}

/// Admin: update reward per settlement.
public fun set_reward(_: &AdminCap, registry: &mut Registry, amount: u64) {
    registry.reward_per_settlement = amount;
}

// === View Functions ===

public fun reward_per_settlement(registry: &Registry): u64 { registry.reward_per_settlement }
public fun treasury_balance(registry: &Registry): u64 { registry.treasury.value() }
public fun is_settled(
    registry: &Registry,
    oracle_id: address,
    manager_id: address,
    expiry: u64,
    strike: u64,
    is_up: bool,
): bool {
    registry.settled_markets.contains(SettlementKey { oracle_id, manager_id, expiry, strike, is_up })
}
