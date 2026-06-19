// Copyright (c) Keeper Network
// SPDX-License-Identifier: Apache-2.0

/// TipRegistry — opt-in / opt-out keeper tip policy for position owners.
///
/// V1 scaffolding: stores preferences on-chain but tips are not yet enforced.
/// Upgrade path: use redeem_permissionless_with_tip once Mysten ships it.
module keeper_registry::tip_registry;

use sui::table::{Self, Table};

// === Errors ===
const ETipBpsTooHigh: u64 = 0;

// === Constants ===

const POLICY_OPT_OUT: u8 = 0;
const MAX_TIP_BPS: u16 = 1_000; // 10% max

public struct AdminCap has key, store { id: UID }

/// Shared object — one per deployment.
public struct TipRegistry has key {
    id: UID,
    /// manager_id → tip_bps. Explicitly registered managers.
    preferences: Table<address, u16>,
    default_policy: u8,
    default_tip_bps: u16,
}

fun init(ctx: &mut TxContext) {
    transfer::share_object(TipRegistry {
        id: object::new(ctx),
        preferences: table::new(ctx),
        default_policy: POLICY_OPT_OUT,
        default_tip_bps: 50,
    });
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

// === Position Owner Functions ===

/// Authorize keepers to settle and take tip_bps from your payout.
public fun opt_in(registry: &mut TipRegistry, manager_id: address, tip_bps: u16) {
    assert!(tip_bps <= MAX_TIP_BPS, ETipBpsTooHigh);
    if (registry.preferences.contains(manager_id)) {
        *registry.preferences.borrow_mut(manager_id) = tip_bps;
    } else {
        registry.preferences.add(manager_id, tip_bps);
    }
}

/// Remove preference (under opt-out policy: keeper stops settling this manager).
public fun opt_out(registry: &mut TipRegistry, manager_id: address) {
    if (registry.preferences.contains(manager_id)) {
        registry.preferences.remove(manager_id);
    }
}

// === Admin ===

public fun set_default_policy(_: &AdminCap, registry: &mut TipRegistry, policy: u8) {
    registry.default_policy = policy;
}

public fun set_default_tip_bps(_: &AdminCap, registry: &mut TipRegistry, bps: u16) {
    assert!(bps <= MAX_TIP_BPS, ETipBpsTooHigh);
    registry.default_tip_bps = bps;
}

// === View ===

/// Effective tip in basis points for a manager. Read by the off-chain keeper.
public fun effective_tip_bps(registry: &TipRegistry, manager_id: address): u16 {
    if (registry.preferences.contains(manager_id)) {
        *registry.preferences.borrow(manager_id)
    } else if (registry.default_policy == POLICY_OPT_OUT) {
        registry.default_tip_bps
    } else {
        0
    }
}

public fun default_policy(registry: &TipRegistry): u8 { registry.default_policy }
public fun default_tip_bps(registry: &TipRegistry): u16 { registry.default_tip_bps }
