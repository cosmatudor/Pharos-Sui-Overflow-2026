import { useState, useEffect, useRef } from "react"
import {
  useCurrentAccount,
  useConnectWallet,
  useDisconnectWallet,
  useWallets,
} from "@mysten/dapp-kit"

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export default function WalletButton() {
  const account      = useCurrentAccount()
  const wallets      = useWallets()
  const { mutate: connect } = useConnectWallet()
  const { mutate: disconnect } = useDisconnectWallet()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  if (account) {
    return (
      <div className="wallet-wrap" ref={ref}>
        <button className="wallet-btn connected" onClick={() => setOpen(o => !o)}>
          <span className="addr-dot" />
          {shortAddr(account.address)}
          <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 2 }}>▾</span>
        </button>
        {open && (
          <div className="wallet-dropdown">
            <div style={{ padding: "10px 16px 6px", fontSize: 11, color: "var(--muted)" }}>
              {shortAddr(account.address)}
            </div>
            <div className="wallet-dropdown-divider" />
            <button
              className="wallet-dropdown-item danger"
              onClick={() => { disconnect(); setOpen(false) }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    )
  }

  if (wallets.length === 0) {
    return (
      <div className="wallet-wrap" ref={ref}>
        <button className="wallet-btn" onClick={() => setOpen(o => !o)}>
          Connect Wallet
        </button>
        {open && (
          <div className="wallet-dropdown">
            <div className="wallet-no-wallets">
              No Sui wallets found.{" "}
              <a
                href="https://chrome.google.com/webstore/detail/sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil"
                target="_blank"
                rel="noopener"
              >
                Install Sui Wallet ↗
              </a>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (wallets.length === 1) {
    return (
      <button className="wallet-btn" onClick={() => connect({ wallet: wallets[0] })}>
        Connect Wallet
      </button>
    )
  }

  return (
    <div className="wallet-wrap" ref={ref}>
      <button className="wallet-btn" onClick={() => setOpen(o => !o)}>
        Connect Wallet
      </button>
      {open && (
        <div className="wallet-dropdown">
          {wallets.map(w => (
            <button
              key={w.name}
              className="wallet-dropdown-item"
              onClick={() => { connect({ wallet: w }); setOpen(false) }}
            >
              {w.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
