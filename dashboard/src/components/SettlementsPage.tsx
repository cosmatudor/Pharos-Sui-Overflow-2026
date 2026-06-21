import type { SettlementEvent } from "../hooks/useNetworkData"
import { EXPLORER_BASE } from "../constants"

interface Props {
  events: SettlementEvent[]
  loading: boolean
  onBack: () => void
}

function shortId(id: string) {
  return `${id.slice(0, 6)}…${id.slice(-4)}`
}

function formatTime(ts: number) {
  if (!ts) return "—"
  return new Date(ts).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

function formatStrike(strike: number) {
  const d = strike / 1e9
  if (d >= 1000) return `$${(d / 1000).toFixed(0)}k`
  return `$${d.toFixed(0)}`
}

function formatRange(lower: number, higher: number) {
  return `${formatStrike(lower)} – ${formatStrike(higher)}`
}

export default function SettlementsPage({ events, loading, onBack }: Props) {
  const binary = events.filter(e => !e.is_range)
  const range  = events.filter(e => e.is_range)
  const totalRewards = events.reduce((s, e) => s + e.reward_paid, 0)

  return (
    <div className="spage">
      {/* Title bar */}
      <div className="spage-titlebar">
        <div className="spage-titlebar-inner">
          <button className="join-back" onClick={onBack}>← Dashboard</button>
          <div className="spage-titlebar-text">
            <h1 className="spage-h1">All Settlements</h1>
            <p className="spage-sub">Every position redeemed by the Pharos keeper network</p>
          </div>
        </div>
      </div>

      <div className="spage-body">
        {/* Summary stats */}
        <div className="spage-stats">
          <div className="spage-stat">
            <span className="spage-stat-label">Total</span>
            <span className="spage-stat-value">{events.length}</span>
          </div>
          <div className="spage-stat">
            <span className="spage-stat-label">Binary</span>
            <span className="spage-stat-value">{binary.length}</span>
          </div>
          <div className="spage-stat">
            <span className="spage-stat-label">Range</span>
            <span className="spage-stat-value" style={{ color: "var(--accent)" }}>{range.length}</span>
          </div>
          <div className="spage-stat">
            <span className="spage-stat-label">Rewards paid</span>
            <span className="spage-stat-value" style={{ color: "var(--green)" }}>
              {(totalRewards / 1e9).toFixed(2)} SUI
            </span>
          </div>
        </div>

        {/* Table */}
        <div className="spage-card">
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : events.length === 0 ? (
            <div className="empty-state">No settlements recorded yet.</div>
          ) : (
            <div className="spage-table-wrap">
              <table className="spage-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Oracle</th>
                    <th>Keeper</th>
                    <th>Type</th>
                    <th>Strike / Band</th>
                    <th>Reward</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev, i) => (
                    <tr key={`${ev.txDigest}-${i}`}>
                      <td className="spage-td-time">{formatTime(ev.timestampMs)}</td>
                      <td>
                        <span className="feed-oracle" title={ev.oracle_id}>{shortId(ev.oracle_id)}</span>
                      </td>
                      <td>
                        <a
                          href={`${EXPLORER_BASE}/account/${ev.keeper}`}
                          target="_blank"
                          rel="noopener"
                          className="spage-keeper-link"
                          title={ev.keeper}
                        >
                          {shortId(ev.keeper)}
                        </a>
                      </td>
                      <td>
                        {ev.is_range ? (
                          <span className="feed-dir" style={{ color: "var(--accent)", background: "var(--accent-dim)" }}>RANGE</span>
                        ) : (
                          <span className={`feed-dir ${ev.is_up ? "up" : "down"}`}>
                            {ev.is_up ? "UP" : "DOWN"}
                          </span>
                        )}
                      </td>
                      <td className="spage-td-strike">
                        {ev.is_range
                          ? formatRange(ev.lower_strike, ev.higher_strike)
                          : formatStrike(ev.strike)}
                      </td>
                      <td className="spage-td-reward">
                        +{(ev.reward_paid / 1e9).toFixed(2)} SUI
                      </td>
                      <td>
                        <a
                          href={`${EXPLORER_BASE}/tx/${ev.txDigest}`}
                          target="_blank"
                          rel="noopener"
                          className="feed-link-btn"
                        >
                          ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
