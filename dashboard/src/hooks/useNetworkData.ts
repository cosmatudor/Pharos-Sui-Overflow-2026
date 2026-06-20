import { useEffect, useState, useCallback } from "react"
import { SuiClient } from "@mysten/sui/client"
import { REGISTRY_ID, EVENT_TYPE, KEEPER_REGISTERED_TYPE, RPC_URL } from "../constants"

export interface SettlementEvent {
  keeper: string
  oracle_id: string
  is_up: boolean
  strike: number
  reward_paid: number
  timestampMs: number
  txDigest: string
}

export interface KeeperStat {
  address: string
  jobs: number
  earnings: number
  lastActive: number
  registered: boolean  // true = has KeeperRegistered event; false = inferred from settlements
}

export interface NetworkData {
  totalSettlements: number
  treasury: number
  rewardPerSettlement: number
  events: SettlementEvent[]
  keepers: KeeperStat[]
  lastUpdated: Date | null
  loading: boolean
  error: string | null
}

const client = new SuiClient({ url: RPC_URL })

export function useNetworkData(pollMs = 30_000): NetworkData {
  const [state, setState] = useState<Omit<NetworkData, "loading" | "error">>({
    totalSettlements: 0,
    treasury: 0,
    rewardPerSettlement: 0,
    events: [],
    keepers: [],
    lastUpdated: null,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [regObj, registrationPage] = await Promise.all([
        client.getObject({ id: REGISTRY_ID, options: { showContent: true } }),
        client.queryEvents({
          query: { MoveEventType: KEEPER_REGISTERED_TYPE },
          order: "descending",
          limit: 100,
        }),
      ])

      // Paginate ALL settlement events for accurate per-keeper stats.
      // Fetch ascending so cursor walk is stable, then reverse for feed display.
      type SuiEvent = Awaited<ReturnType<typeof client.queryEvents>>["data"][number]
      const allSettlementEvents: SuiEvent[] = []
      let cursor: { txDigest: string; eventSeq: string } | undefined = undefined
      for (;;) {
        const page = await client.queryEvents({
          query: { MoveEventType: EVENT_TYPE },
          order: "ascending",
          limit: 50,
          ...(cursor ? { cursor } : {}),
        })
        allSettlementEvents.push(...page.data)
        if (!page.hasNextPage || !page.nextCursor) break
        cursor = page.nextCursor as { txDigest: string; eventSeq: string }
      }
      const settlementData = [...allSettlementEvents].reverse()

      // Registry fields
      const fields = (regObj.data?.content as { fields?: Record<string, unknown> })?.fields ?? {}
      const treasury = Number(fields.treasury ?? 0)
      const rewardPerSettlement = Number(fields.reward_per_settlement ?? 0)
      const totalSettlements = Number(
        (fields.settled_markets as { fields?: { size?: string } })?.fields?.size ?? 0
      )

      // Settlement events → per-keeper stats
      const events: SettlementEvent[] = settlementData.map(e => {
        const j = e.parsedJson as Record<string, unknown>
        return {
          keeper:      String(j.keeper ?? ""),
          oracle_id:   String(j.oracle_id ?? ""),
          is_up:       Boolean(j.is_up),
          strike:      Number(j.strike ?? 0),
          reward_paid: Number(j.reward_paid ?? 0),
          timestampMs: Number(e.timestampMs ?? 0),
          txDigest:    e.id.txDigest,
        }
      })

      const keeperMap = new Map<string, KeeperStat>()
      for (const ev of events) {
        const k = keeperMap.get(ev.keeper) ?? {
          address: ev.keeper, jobs: 0, earnings: 0, lastActive: 0, registered: false,
        }
        k.jobs++
        k.earnings += ev.reward_paid
        k.lastActive = Math.max(k.lastActive, ev.timestampMs)
        keeperMap.set(ev.keeper, k)
      }

      // Registration events → merge in keepers that haven't earned yet
      for (const e of registrationPage.data) {
        const j = e.parsedJson as Record<string, unknown>
        const addr = String(j.keeper ?? "")
        if (!addr) continue
        const existing = keeperMap.get(addr)
        if (existing) {
          existing.registered = true
        } else {
          keeperMap.set(addr, {
            address: addr,
            jobs: 0,
            earnings: 0,
            lastActive: Number(e.timestampMs ?? 0),
            registered: true,
          })
        }
      }

      // Mark all keepers found via settlement events as registered too
      // (they registered before we added the KeeperRegistered event)
      for (const k of keeperMap.values()) {
        if (k.jobs > 0) k.registered = true
      }

      const keepers = [...keeperMap.values()].sort((a, b) => b.jobs - a.jobs)

      setState({ totalSettlements, treasury, rewardPerSettlement, events, keepers, lastUpdated: new Date() })
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load network data")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, pollMs)
    return () => clearInterval(id)
  }, [refresh, pollMs])

  return { ...state, loading, error }
}
