import WalletButton from "./WalletButton"

interface Props {
  onNavigate: (page: "dashboard" | "join") => void
  currentPage: "dashboard" | "join"
}

export default function Header({ onNavigate, currentPage }: Props) {
  return (
    <header className="header">
      <div className="header-left">
        <button
          className="logo"
          onClick={() => onNavigate("dashboard")}
          style={{ cursor: "pointer", border: "none" }}
          aria-label="Dashboard"
        >
          ⚡
        </button>
        <div>
          <button
            onClick={() => onNavigate("dashboard")}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}
          >
            <div className="header-title">Keeper Network</div>
            <div className="header-sub">Permissionless settlement · DeepBook Predict · Sui</div>
          </button>
        </div>
      </div>

      <div className="header-right">
        <div className="network-badge">
          <span className="pulse" />
          Testnet
        </div>
        <button
          onClick={() => onNavigate(currentPage === "join" ? "dashboard" : "join")}
          className={`header-nav-btn ${currentPage === "join" ? "active" : ""}`}
        >
          {currentPage === "join" ? "← Dashboard" : "Run a Node"}
        </button>
        <WalletButton />
      </div>
    </header>
  )
}
