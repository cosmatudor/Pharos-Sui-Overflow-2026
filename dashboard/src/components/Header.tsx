import WalletButton from "./WalletButton"

export default function Header() {
  return (
    <header className="header">
      <div className="header-left">
        <div className="logo">⚡</div>
        <div>
          <div className="header-title">Keeper Network</div>
          <div className="header-sub">Permissionless settlement · DeepBook Predict · Sui</div>
        </div>
      </div>
      <div className="header-right">
        <div className="network-badge">
          <span className="pulse" />
          Testnet
        </div>
        <WalletButton />
      </div>
    </header>
  )
}
