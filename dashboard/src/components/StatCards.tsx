interface Props {
  totalSettlements: number
  treasury: number
  rewardPerSettlement: number
  activeKeepers: number
  loading: boolean
}

function mist(v: number) {
  return (v / 1e9).toFixed(2) + " SUI"
}

export default function StatCards({ totalSettlements, treasury, rewardPerSettlement, activeKeepers, loading }: Props) {
  if (loading) {
    return (
      <div className="stats-grid">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="stat-card">
            <div className="stat-label skeleton" style={{ width: 80, height: 12, marginBottom: 14 }} />
            <div className="skeleton" style={{ width: 100, height: 28 }} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="stats-grid">
      <div className="stat-card">
        <div className="stat-label">Total Settlements</div>
        <div className="stat-value">{totalSettlements.toLocaleString()}</div>
        <div className="stat-sub">positions settled on-chain</div>
      </div>

      <div className="stat-card">
        <div className="stat-label">Treasury</div>
        <div className="stat-value">{mist(treasury)}</div>
        <div className="stat-sub">keeper reward pool</div>
      </div>

      <div className="stat-card accent">
        <div className="stat-label">Reward / Settlement</div>
        <div className="stat-value">{mist(rewardPerSettlement)}</div>
        <div className="stat-sub">earned per position</div>
      </div>

      <div className="stat-card green">
        <div className="stat-label">Active Keepers</div>
        <div className="stat-value">{activeKeepers}</div>
        <div className="stat-sub">nodes running</div>
      </div>
    </div>
  )
}
