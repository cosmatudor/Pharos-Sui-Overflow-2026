export default function HowItWorks() {
  return (
    <div className="how-grid">
      <div className="how-card">
        <div className="how-icon">🔍</div>
        <div className="how-step">Step 01</div>
        <div className="how-title">Scan settled oracles</div>
        <div className="how-desc">
          The keeper polls all 240+ DeepBook Predict managers every 30 seconds.
          When the oracle price is published, any position at that strike becomes redeemable.
        </div>
      </div>

      <div className="how-card">
        <div className="how-icon">⚡</div>
        <div className="how-step">Step 02</div>
        <div className="how-title">Settle & record atomically</div>
        <div className="how-desc">
          A single PTB calls <span className="mono" style={{ fontSize: 11 }}>redeem_permissionless</span> and{" "}
          <span className="mono" style={{ fontSize: 11 }}>record_settlement</span> together.
          The registry ensures only one keeper earns per position — no double work.
        </div>
      </div>

      <div className="how-card">
        <div className="how-icon">💰</div>
        <div className="how-step">Step 03</div>
        <div className="how-title">Earn SUI rewards</div>
        <div className="how-desc">
          The registry transfers the reward from its treasury to your wallet after each successful settlement.
          Rewards accumulate as long as the treasury is funded.
        </div>
      </div>
    </div>
  )
}
