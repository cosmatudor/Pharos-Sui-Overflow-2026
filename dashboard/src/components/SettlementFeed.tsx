import type { SettlementEvent } from "../hooks/useNetworkData"
import { EXPLORER_BASE } from "../constants"

interface Props {
  events: SettlementEvent[]
  loading: boolean
}

function shortId(id: string) {
  return `${id.slice(0, 6)}…${id.slice(-4)}`
}

function relativeTime(ts: number) {
  if (!ts) return ""
  const diff = (Date.now() - ts) / 1000
  if (diff < 60)  return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function formatStrike(strike: number) {
  const d = strike / 1e9
  if (d >= 1000) return `$${(d / 1000).toFixed(0)}k`
  return `$${d.toFixed(0)}`
}

export default function SettlementFeed({ events, loading }: Props) {
  if (loading) {
    return (
      <div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="feed-row" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="skeleton" style={{ height: 14, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 14, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 14, width: 40, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 14, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 14, borderRadius: 4 }} />
          </div>
        ))}
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="empty-state">
        No settlements recorded yet.<br />
        <span style={{ fontSize: 12 }}>Events appear here as keepers settle positions.</span>
      </div>
    )
  }

  return (
    <div>
      <div className="feed-header">
        <span>Oracle</span>
        <span className="feed-col-keeper">Keeper</span>
        <span>Dir</span>
        <span>Strike</span>
        <span>Reward</span>
        <span />
      </div>
      {events.slice(0, 20).map((ev, i) => (
        <div key={`${ev.txDigest}-${i}`} className="feed-row">
          <span className="feed-oracle" title={ev.oracle_id}>{shortId(ev.oracle_id)}</span>
          <span className="feed-keeper feed-col-keeper" title={ev.keeper}>{shortId(ev.keeper)}</span>
          <span className={`feed-dir ${ev.is_up ? "up" : "down"}`}>
            {ev.is_up ? "UP" : "DOWN"}
          </span>
          <span className="feed-strike">{formatStrike(ev.strike)}</span>
          <span className="feed-reward">+{(ev.reward_paid / 1e9).toFixed(2)}</span>
          <a
            href={`${EXPLORER_BASE}/tx/${ev.txDigest}`}
            target="_blank"
            rel="noopener"
            className="feed-link-btn"
            title={relativeTime(ev.timestampMs)}
          >
            ↗
          </a>
        </div>
      ))}
    </div>
  )
}
