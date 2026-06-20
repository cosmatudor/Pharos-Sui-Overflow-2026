export default function HowItWorks() {
  return (
    <div className="how-grid">
      <div className="how-card">
        <div className="how-icon">⚡</div>
        <div className="how-step">Step 01</div>
        <div className="how-title">Event-driven indexing</div>
        <div className="how-desc">
          The keeper subscribes to <span className="mono" style={{ fontSize: 11 }}>PositionMinted</span> events
          on-chain every 2 seconds, building a live DB of redeemable positions as they're created.
        </div>
      </div>

      <div className="how-card">
        <div className="how-icon">🔒</div>
        <div className="how-step">Step 02</div>
        <div className="how-title">Settle & record atomically</div>
        <div className="how-desc">
          A single PTB calls <span className="mono" style={{ fontSize: 11 }}>redeem_permissionless</span> and{" "}
          <span className="mono" style={{ fontSize: 11 }}>record_settlement</span> together.
          The on-chain registry ensures only one keeper earns per position.
        </div>
      </div>

      <div className="how-card">
        <div className="how-icon">💰</div>
        <div className="how-step">Step 03</div>
        <div className="how-title">Earn SUI rewards</div>
        <div className="how-desc">
          The registry transfers SUI from its treasury to your wallet after every successful settlement.
          Bond, compete, and earn — permissionless and non-custodial.
        </div>
      </div>
    </div>
  )
}
