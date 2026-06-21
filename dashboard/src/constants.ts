export const RPC_URL = "https://fullnode.testnet.sui.io:443"

export const REGISTRY_PKG =
  "0xba7e6347effb2675abe6be5878d16b2b164fb8568ff026a84fdfd16a1fda6231"

export const REGISTRY_ID =
  "0x30e72c2997fca9986a8e8db2b9fedf50ce199a508534241cf4ae4e11712b47c9"

export const EVENT_TYPE =
  `${REGISTRY_PKG}::registry::SettlementRecorded`

export const RANGE_EVENT_TYPE =
  `${REGISTRY_PKG}::registry::RangeSettlementRecorded`

export const KEEPER_REGISTERED_TYPE =
  `${REGISTRY_PKG}::credential::KeeperRegistered`

export const CREDENTIAL_TYPE =
  `${REGISTRY_PKG}::credential::KeeperCredential`

export const CLOCK_ID = "0x6"

export const MIN_BOND_MIST = 1_000_000_000n

export const EXPLORER_BASE = "https://suiscan.xyz/testnet"
