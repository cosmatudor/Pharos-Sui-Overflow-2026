import type { KeeperStat } from "../hooks/useNetworkData"
import { EXPLORER_BASE } from "../constants"

interface Props {
  keepers: KeeperStat[]
  loading: boolean
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`
}

function rankClass(i: number) {
  if (i === 0) return "gold"
  if (i === 1) return "silver"
  if (i === 2) return "bronze"
  return ""
}

export default function KeeperTable({ keepers, loading }: Props) {
  if (loading) {
    return (
      <table className="keeper-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Address</th>
            <th>Jobs</th>
            <th>Earned</th>
          </tr>
        </thead>
        <tbody>
          {[...Array(3)].map((_, i) => (
            <tr key={i}>
              <td><div className="skeleton" style={{ width: 22, height: 22, borderRadius: "50%" }} /></td>
              <td><div className="skeleton" style={{ height: 14, borderRadius: 4 }} /></td>
              <td><div className="skeleton" style={{ width: 30, height: 14, borderRadius: 4 }} /></td>
              <td><div className="skeleton" style={{ width: 60, height: 14, borderRadius: 4 }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  if (keepers.length === 0) {
    return (
      <div className="empty-state">
        No keepers active yet.<br />
        <a href="#register" style={{ color: "var(--accent)", fontSize: 12 }}>Be the first →</a>
      </div>
    )
  }

  return (
    <table className="keeper-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Address</th>
          <th>Jobs</th>
          <th>Earned</th>
        </tr>
      </thead>
      <tbody>
        {keepers.map((k, i) => (
          <tr key={k.address}>
            <td>
              <span className={`keeper-rank ${rankClass(i)}`}>{i + 1}</span>
            </td>
            <td className="keeper-addr">
              <a
                href={`${EXPLORER_BASE}/account/${k.address}`}
                target="_blank"
                rel="noopener"
                title={k.address}
              >
                {shortAddr(k.address)}
              </a>
            </td>
            <td className="keeper-jobs">{k.jobs.toLocaleString()}</td>
            <td className="keeper-earnings">
              {(k.earnings / 1e9).toFixed(2)} SUI
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
