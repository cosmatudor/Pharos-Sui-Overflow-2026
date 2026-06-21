export default function HowItWorks() {
  return (
    <div className="how-grid">
      <div className="how-card">
        <div className="how-icon">👁️</div>
        <div className="how-step">Step 01</div>
        <div className="how-title">Watch the market</div>
        <div className="how-desc">
          Your Pharos keeper monitors DeepBook Predict in real time.
          The moment a prediction market expires, it spots every position ready to be settled.
        </div>
      </div>

      <div className="how-card">
        <div className="how-icon">⚡</div>
        <div className="how-step">Step 02</div>
        <div className="how-title">Settle first, win the reward</div>
        <div className="how-desc">
          Keepers race to settle expired positions on-chain. The first one to submit
          earns the reward — the on-chain registry guarantees no position pays out twice.
        </div>
      </div>

      <div className="how-card">
        <div className="how-icon">💰</div>
        <div className="how-step">Step 03</div>
        <div className="how-title">Earn SUI, non-custodial</div>
        <div className="how-desc">
          Rewards land directly in your wallet after every settlement.
          Your funds are always yours — bond, compete, and withdraw any time.
        </div>
      </div>
    </div>
  )
}
