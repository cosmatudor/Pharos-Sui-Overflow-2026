// list-markets.ts
// Shows all live oracles with expiry, underlying asset, and min strike.
// Run: npm run list-markets

export {}

const SERVER_URL  = "https://predict-server.testnet.mystenlabs.com"
const PREDICT_OBJ = "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a"

interface ApiOracle {
  oracle_id:        string
  status:           string
  expiry:           number
  settlement_price: number | null
  underlying_asset: string
  min_strike:       string
}

const resp = await fetch(`${SERVER_URL}/predicts/${PREDICT_OBJ}/oracles`)
if (!resp.ok) { console.error(`Server error: ${resp.status}`); process.exit(1) }
const all: ApiOracle[] = await resp.json()

const live = all
  .filter(o => o.status === "active" && o.settlement_price === null && o.expiry > Date.now())
  .sort((a, b) => a.expiry - b.expiry)

if (live.length === 0) { console.log("No live oracles."); process.exit(0) }

console.log(`\n${"ORACLE_ID".padEnd(68)} ${"ASSET".padEnd(6)} ${"EXPIRY (UTC)".padEnd(25)} MIN_STRIKE`)
console.log("─".repeat(120))

for (const o of live) {
  const strikeDollars = (Number(o.min_strike) / 1e9).toLocaleString()
  const expiresIn     = Math.round((o.expiry - Date.now()) / 3_600_000)
  const expStr        = `${new Date(o.expiry).toISOString()} (~${expiresIn}h)`
  console.log(`${o.oracle_id.padEnd(68)} ${o.underlying_asset.padEnd(6)} ${expStr.padEnd(35)} $${strikeDollars}`)
}

console.log(`\nTotal live: ${live.length}`)
console.log(`\nTo mint on the nearest oracle:`)
console.log(`  npm run demo-mint`)