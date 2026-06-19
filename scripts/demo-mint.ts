// demo-mint.ts
// Finds the nearest live oracle, creates a PredictManager if needed, and
// mints one UP + one DOWN position so the keeper has real work to do.
//
// Usage:
//   npm run demo-mint
//   MANAGER_ID=0x... npm run demo-mint   (reuse existing manager)

import { SuiClient } from "@mysten/sui/client"
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography"
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { Transaction } from "@mysten/sui/transactions"

// ── Constants ─────────────────────────────────────────────────────────────────

const RPC_URL     = "https://fullnode.testnet.sui.io:443"
const SERVER_URL  = "https://predict-server.testnet.mystenlabs.com"
const PREDICT_PKG = "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138"
const PREDICT_OBJ = "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a"
const DUSDC_PKG   = "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a"
const DUSDC_TYPE  = `${DUSDC_PKG}::dusdc::DUSDC`
const CLOCK       = "0x6"

const PRICE_SCALE   = 1_000_000_000n   // 1e9 — strikes stored at 9 decimals
const DUSDC_SCALE   = 1_000_000n       // 1e6 — DUSDC at 6 decimals
const QUANTITY_FACE = 5n              // $5 face value per position

// ── Signer ────────────────────────────────────────────────────────────────────

function loadKeypair(): Ed25519Keypair {
  const raw = process.env.SUI_PRIVATE_KEY
  if (!raw) throw new Error("SUI_PRIVATE_KEY not set in .env")
  const { secretKey } = decodeSuiPrivateKey(raw)
  return Ed25519Keypair.fromSecretKey(secretKey)
}

// ── Predict server ────────────────────────────────────────────────────────────

interface ApiOracle {
  oracle_id:        string
  status:           string
  expiry:           number   // ms since epoch
  settlement_price: number | null
  underlying_asset: string
  min_strike:       string   // 1e9-scaled u64 as string
}

async function getLiveOracles(): Promise<ApiOracle[]> {
  const resp = await fetch(`${SERVER_URL}/predicts/${PREDICT_OBJ}/oracles`)
  if (!resp.ok) throw new Error(`predict server error: ${resp.status}`)
  const all: ApiOracle[] = await resp.json()
  return all
    .filter(o => o.status === "active" && o.settlement_price === null && o.expiry > Date.now() + 60 * 60_000)
    .sort((a, b) => a.expiry - b.expiry)   // nearest expiry first (at least 1h away)
}

// ── Sui helpers ───────────────────────────────────────────────────────────────

type Coin = { coinObjectId: string; balance: string }

async function getDusdc(client: SuiClient, address: string): Promise<Coin[]> {
  const res = await client.getCoins({ owner: address, coinType: DUSDC_TYPE })
  return res.data
}

async function createManager(client: SuiClient, kp: Ed25519Keypair): Promise<string> {
  console.log("Creating PredictManager…")
  const tx = new Transaction()
  tx.moveCall({ target: `${PREDICT_PKG}::predict::create_manager`, arguments: [] })
  const res = await client.signAndExecuteTransaction({
    transaction: tx, signer: kp,
    options: { showEffects: true, showObjectChanges: true },
  })
  if (res.effects?.status.status !== "success")
    throw new Error(`create_manager failed: ${JSON.stringify(res.effects?.status)}`)
  const obj = res.objectChanges?.find(
    c => c.type === "created" && c.objectType.includes("::predict_manager::PredictManager")
  )
  if (!obj || obj.type !== "created") throw new Error("PredictManager not in objectChanges")
  return obj.objectId
}

async function mint(
  client:    SuiClient,
  kp:        Ed25519Keypair,
  managerId: string,
  oracle:    ApiOracle,
  direction: "up" | "down",
  strike:    bigint,
  coins:     Coin[],
): Promise<string> {
  const quantity = QUANTITY_FACE * DUSDC_SCALE
  const total    = coins.reduce((s, c) => s + BigInt(c.balance), 0n)
  if (total < quantity)
    throw new Error(`Insufficient DUSDC: have $${Number(total)/1e6}, need $${Number(quantity)/1e6}`)

  const tx      = new Transaction()
  const primary = tx.object(coins[0].coinObjectId)
  if (coins.length > 1)
    tx.mergeCoins(primary, coins.slice(1).map(c => tx.object(c.coinObjectId)))

  const [depositCoin] = tx.splitCoins(primary, [tx.pure.u64(quantity)])
  tx.moveCall({
    target: `${PREDICT_PKG}::predict_manager::deposit`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(managerId), depositCoin],
  })

  const key = tx.moveCall({
    target: `${PREDICT_PKG}::market_key::${direction}`,
    arguments: [
      tx.pure.id(oracle.oracle_id),
      tx.pure.u64(BigInt(oracle.expiry)),
      tx.pure.u64(strike),
    ],
  })

  tx.moveCall({
    target: `${PREDICT_PKG}::predict::mint`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PREDICT_OBJ),
      tx.object(managerId),
      tx.object(oracle.oracle_id),
      key,
      tx.pure.u64(quantity),
      tx.object(CLOCK),
    ],
  })

  const res = await client.signAndExecuteTransaction({
    transaction: tx, signer: kp,
    options: { showEffects: true },
  })
  if (res.effects?.status.status !== "success")
    throw new Error(`mint ${direction} failed: ${JSON.stringify(res.effects?.status)}`)
  return res.digest
}

// ── Main ──────────────────────────────────────────────────────────────────────

const kp      = loadKeypair()
const address = kp.getPublicKey().toSuiAddress()
const client  = new SuiClient({ url: RPC_URL })

console.log(`Wallet: ${address}\n`)

// 1. Find nearest live oracle
console.log("Fetching live oracles…")
const oracles = await getLiveOracles()
if (oracles.length === 0) {
  console.error("No live oracles found — all are settled or expired.")
  process.exit(1)
}

// Fetch spot price and round to nearest $1,000 — min_strike is often far below spot
// which causes quote_spread_from_fair_price to fail (near-certain outcome).
const spotResp  = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT")
const spotJson  = await spotResp.json() as { price: string }
const spotUsd   = Math.round(Number(spotJson.price) / 1000) * 1000
const spotMist  = BigInt(spotUsd) * PRICE_SCALE

const oracle      = oracles[0]
const minStrike   = BigInt(oracle.min_strike)
const strike      = spotMist > minStrike ? spotMist : minStrike
const strikeFmt   = `$${(Number(strike) / 1e9).toLocaleString()}`
const expiresIn   = Math.round((oracle.expiry - Date.now()) / 3_600_000)
console.log(`Oracle:  ${oracle.oracle_id}`)
console.log(`Asset:   ${oracle.underlying_asset}`)
console.log(`Expiry:  ${new Date(oracle.expiry).toISOString()} (~${expiresIn}h from now)`)
console.log(`Spot:    $${spotUsd.toLocaleString()} (Binance)`)
console.log(`Strike:  ${strikeFmt}\n`)

// 2. DUSDC balance
const coins  = await getDusdc(client, address)
const total  = coins.reduce((s, c) => s + BigInt(c.balance), 0n)
console.log(`DUSDC:   $${Number(total) / 1e6}`)
if (total < QUANTITY_FACE * DUSDC_SCALE * 2n) {
  console.error(`\nNeed at least $${Number(QUANTITY_FACE * 2n)} DUSDC (UP + DOWN).`)
  console.error(`Ask the DeepBook team to mint DUSDC to your address, or use the predict workshop faucet.`)
  process.exit(1)
}

// 3. Manager
let managerId = process.env.MANAGER_ID ?? ""
if (managerId) {
  console.log(`Manager: ${managerId} (reusing)\n`)
} else {
  managerId = await createManager(client, kp)
  console.log(`\n  Save for later:  MANAGER_ID=${managerId}\n`)
}

// 4. Mint UP
console.log(`Minting UP  ($${QUANTITY_FACE} face @ ${strikeFmt})…`)
const upTx = await mint(client, kp, managerId, oracle, "up", strike, coins)
console.log(`  tx: ${upTx}`)

// Re-fetch coins — balance changed
const freshCoins = await getDusdc(client, address)

// 5. Mint DOWN
console.log(`Minting DOWN ($${QUANTITY_FACE} face @ ${strikeFmt})…`)
const downTx = await mint(client, kp, managerId, oracle, "down", strike, freshCoins)
console.log(`  tx: ${downTx}`)

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Positions staged.

  Oracle:   ${oracle.oracle_id}
  Asset:    ${oracle.underlying_asset}
  Strike:   ${strikeFmt}
  Expiry:   ${new Date(oracle.expiry).toISOString()}
  Manager:  ${managerId}

  When this oracle settles (~${expiresIn}h), run:
    MANAGER_ID=${managerId} make run

  The keeper will scan, find these 2 positions,
  call redeem_permissionless + record_settlement,
  and emit SettlementRecorded events.
  The dashboard will show them within 30s.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)