import { useCurrentAccount } from "@mysten/dapp-kit"
import Header from "./components/Header"
import StatCards from "./components/StatCards"
import SettlementFeed from "./components/SettlementFeed"
import KeeperTable from "./components/KeeperTable"
import RegisterFlow from "./components/RegisterFlow"
import HowItWorks from "./components/HowItWorks"
import HeroCanvas from "./components/HeroCanvas"
import { useNetworkData } from "./hooks/useNetworkData"
import { REGISTRY_ID, EXPLORER_BASE } from "./constants"

export default function App() {
  const account = useCurrentAccount()
  const network = useNetworkData()

  return (
    <>
      <Header />

      {/* Hero */}
      <section className="hero">
        <HeroCanvas />
        <div className="hero-content">
          <div className="hero-badge">Live on Sui Testnet</div>
          <h1 className="hero-title">
            Keep DeFi<br />
            <span>Running.</span>
          </h1>
          <p className="hero-sub">
            An open network of permissionless keeper nodes that settle DeepBook Predict positions on-chain. Bond SUI, compete, earn rewards.
          </p>
          <div className="hero-ctas">
            <a href="#register" className="hero-cta-primary">
              Join the Network →
            </a>
            <a href="#network" className="hero-cta-ghost">
              Live Data ↓
            </a>
          </div>
        </div>
        <div className="hero-scroll-hint">scroll</div>
      </section>

      {/* Main content */}
      <div className="page" id="network">

        <StatCards
          totalSettlements={network.totalSettlements}
          treasury={network.treasury}
          rewardPerSettlement={network.rewardPerSettlement}
          activeKeepers={network.keepers.length}
          loading={network.loading}
        />

        <div className="data-grid">
          <div className="section">
            <div className="section-header">
              <span className="section-title">Live Settlements</span>
              {network.lastUpdated && (
                <span className="section-meta">
                  Updated {network.lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </div>
            <div className="card">
              <SettlementFeed events={network.events} loading={network.loading} />
            </div>
          </div>

          <div className="section">
            <div className="section-header">
              <span className="section-title">Active Keepers</span>
              <span className="section-meta">
                {network.keepers.length} node{network.keepers.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="card">
              <KeeperTable keepers={network.keepers} loading={network.loading} />
            </div>
          </div>
        </div>

        <div className="section" id="register">
          <div className="section-header">
            <span className="section-title">Join the Network</span>
          </div>
          <RegisterFlow account={account} rewardPerSettlement={network.rewardPerSettlement} />
        </div>

        <div className="section">
          <div className="section-header">
            <span className="section-title">How It Works</span>
          </div>
          <HowItWorks />
        </div>

        <footer className="footer">
          <span>
            Registry:{" "}
            <a
              href={`${EXPLORER_BASE}/object/${REGISTRY_ID}`}
              target="_blank"
              rel="noopener"
              className="mono"
            >
              {REGISTRY_ID.slice(0, 10)}…{REGISTRY_ID.slice(-4)}
            </a>
          </span>
          <div className="footer-links">
            <a href={`${EXPLORER_BASE}/object/${REGISTRY_ID}`} target="_blank" rel="noopener">
              Explorer ↗
            </a>
            <a href="https://sui.io" target="_blank" rel="noopener">
              Sui Testnet
            </a>
          </div>
        </footer>
      </div>
    </>
  )
}
