import WalletButton from "./WalletButton"

interface Props {
  onNavigate: (page: "dashboard" | "join" | "settlements") => void
  currentPage: "dashboard" | "join" | "settlements"
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
          <img src="/pharos.png" alt="Pharos" style={{ width: 72, height: 72, objectFit: "cover" }} />
        </button>
        <button
          onClick={() => onNavigate("dashboard")}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          <span className="header-title">Pharos</span>
        </button>
      </div>

      <div className="header-right">
        <div className="network-badge">
          <span className="pulse" />
          Testnet
        </div>
        <button
          onClick={() => onNavigate(currentPage === "dashboard" ? "join" : "dashboard")}
          className={`header-nav-btn ${currentPage !== "dashboard" ? "active" : ""}`}
        >
          {currentPage === "dashboard" ? "Run a Keeper" : "← Dashboard"}
        </button>
        <WalletButton />
      </div>
    </header>
  )
}
