// Copyright (c) Keeper Network
// SPDX-License-Identifier: Apache-2.0

/// KeeperCredential — a bonded identity for keeper operators.
module keeper_registry::credential;

use sui::balance::Balance;
use sui::clock::Clock;
use sui::coin::Coin;
use sui::event;
use sui::sui::SUI;

// === Events ===

/// Emitted when a new keeper bonds SUI and joins the network.
/// Off-chain dashboards use this to discover all registered keepers,
/// including those that haven't won a settlement yet.
public struct KeeperRegistered has copy, drop {
    keeper: address,
    bonded: u64,
}

// === Errors ===
const EBondTooLow: u64 = 0;
const EStillActivating: u64 = 1;
const EWrongOwner: u64 = 2;

// === Constants ===

const MIN_BOND: u64 = 1_000_000_000; // 1 SUI in MIST

/// 0 for testnet (instant activation for demos).
/// Set to 259_200_000 (3 days in ms) before mainnet deploy.
const ACTIVATION_DELAY_MS: u64 = 0;

// === Structs ===

public struct KeeperCredential has key {
    id: UID,
    keeper: address,
    bonded: Balance<SUI>,
    jobs_completed: u64,
    /// Timestamp (ms) when this credential becomes eligible to work.
    activated_at: u64,
}

// === Public Functions ===

/// Bond SUI and receive a KeeperCredential.
public fun register(stake: Coin<SUI>, clk: &Clock, ctx: &mut TxContext) {
    assert!(stake.value() >= MIN_BOND, EBondTooLow);
    let bonded = stake.value();
    let cred = KeeperCredential {
        id: object::new(ctx),
        keeper: ctx.sender(),
        bonded: stake.into_balance(),
        jobs_completed: 0,
        activated_at: clk.timestamp_ms() + ACTIVATION_DELAY_MS,
    };
    event::emit(KeeperRegistered { keeper: ctx.sender(), bonded });
    transfer::transfer(cred, ctx.sender());
}

/// Return bonded SUI and destroy the credential.
public fun unbond(cred: KeeperCredential, clk: &Clock, ctx: &mut TxContext): Coin<SUI> {
    assert!(cred.keeper == ctx.sender(), EWrongOwner);
    assert!(clk.timestamp_ms() >= cred.activated_at, EStillActivating);
    let KeeperCredential { id, keeper: _, bonded, jobs_completed: _, activated_at: _ } = cred;
    id.delete();
    bonded.into_coin(ctx)
}

// === Package-Internal Functions ===

/// Assert the credential is active and owned by ctx.sender().
public(package) fun assert_active(cred: &KeeperCredential, clk: &Clock, ctx: &TxContext) {
    assert!(cred.keeper == ctx.sender(), EWrongOwner);
    assert!(clk.timestamp_ms() >= cred.activated_at, EStillActivating);
}

/// Increment the job counter after a successful settlement.
public(package) fun increment_jobs(cred: &mut KeeperCredential) {
    cred.jobs_completed = cred.jobs_completed + 1;
}

// === View Functions ===

public fun keeper(cred: &KeeperCredential): address { cred.keeper }
public fun jobs_completed(cred: &KeeperCredential): u64 { cred.jobs_completed }
public fun bonded_amount(cred: &KeeperCredential): u64 { cred.bonded.value() }
public fun activated_at(cred: &KeeperCredential): u64 { cred.activated_at }
