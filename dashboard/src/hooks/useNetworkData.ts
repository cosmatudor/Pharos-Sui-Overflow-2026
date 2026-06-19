import { useEffect, useState, useCallback } from "react"
import { SuiClient } from "@mysten/sui/client"
import { REGISTRY_ID, EVENT_TYPE, RPC_URL } from "../constants"

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
      const [regObj, eventsPage] = await Promise.all([
        client.getObject({ id: REGISTRY_ID, options: { showContent: true } }),
        client.queryEvents({
          query: { MoveEventType: EVENT_TYPE },
          order: "descending",
          limit: 50,
        }),
      ])

      const fields = (regObj.data?.content as { fields?: Record<string, unknown> })?.fields ?? {}
      const treasury = Number(
        (fields.treasury as { fields?: { value?: string } })?.fields?.value ??
        (fields.treasury as { value?: string })?.value ??
        0
      )
      const rewardPerSettlement = Number(fields.reward_per_settlement ?? 0)
      const totalSettlements = Number(fields.total_settlements ?? 0)

      const events: SettlementEvent[] = eventsPage.data.map(e => {
        const j = e.parsedJson as Record<string, unknown>
        return {
          keeper:     String(j.keeper ?? ""),
          oracle_id:  String(j.oracle_id ?? ""),
          is_up:      Boolean(j.is_up),
          strike:     Number(j.strike ?? 0),
          reward_paid: Number(j.reward_paid ?? 0),
          timestampMs: Number(e.timestampMs ?? 0),
          txDigest:   e.id.txDigest,
        }
      })

      const keeperMap = new Map<string, KeeperStat>()
      for (const ev of events) {
        const k = keeperMap.get(ev.keeper) ?? {
          address: ev.keeper, jobs: 0, earnings: 0, lastActive: 0,
        }
        k.jobs++
        k.earnings += ev.reward_paid
        k.lastActive = Math.max(k.lastActive, ev.timestampMs)
        keeperMap.set(ev.keeper, k)
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
