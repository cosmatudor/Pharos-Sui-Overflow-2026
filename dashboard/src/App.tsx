import { useCurrentAccount } from "@mysten/dapp-kit"
import Header from "./components/Header"
import StatCards from "./components/StatCards"
import SettlementFeed from "./components/SettlementFeed"
import KeeperTable from "./components/KeeperTable"
import RegisterFlow from "./components/RegisterFlow"
import HowItWorks from "./components/HowItWorks"
import { useNetworkData } from "./hooks/useNetworkData"
import { REGISTRY_ID, EXPLORER_BASE } from "./constants"

export default function App() {
  const account = useCurrentAccount()
  const network = useNetworkData()

  return (
    <div className="page">
      <Header />

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
            <span className="section-meta">{network.keepers.length} node{network.keepers.length !== 1 ? "s" : ""}</span>
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
  )
}
