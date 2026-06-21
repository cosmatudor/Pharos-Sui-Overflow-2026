import { useState, useRef } from "react"
import {
  useCurrentAccount,
  useWallets,
  useConnectWallet,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit"
import { Transaction } from "@mysten/sui/transactions"
import { useQueryClient } from "@tanstack/react-query"
import { useKeeperStatus } from "../hooks/useKeeperStatus"
import { REGISTRY_PKG, CLOCK_ID, EXPLORER_BASE } from "../constants"

type TxState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; digest: string }
  | { status: "error"; message: string }

type StepStatus = "complete" | "active" | "locked"

function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className={`copy-btn ${copied ? "copied" : ""}`}
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
    >
      {copied ? "✓ Copied" : label}
    </button>
  )
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className="code-snippet" style={{ marginBottom: 10 }}>
      <div className="code-snippet-header">
        <span>{label}</span>
        <CopyBtn text={code} />
      </div>
      <code className="snippet">{code}</code>
    </div>
  )
}

export default function JoinPage({ onBack }: { onBack: () => void }) {
  const account = useCurrentAccount()
  const wallets = useWallets()
  const { mutate: connect } = useConnectWallet()
  const { mutate: signAndExecute } = useSignAndExecuteTransaction()
  const queryClient = useQueryClient()
  const { credential, loading: credLoading } = useKeeperStatus(account?.address)
  const [tx, setTx] = useState<TxState>({ status: "idle" })
  const stepRefs = useRef<(HTMLDivElement | null)[]>([])

  const hasWallet  = wallets.length > 0
  const isConnected = !!account
  const hasCred    = !!credential

  const statuses: StepStatus[] = [
    hasWallet   ? "complete" : "active",
    isConnected ? "complete" : hasWallet   ? "active" : "locked",
    hasCred     ? "complete" : isConnected ? "active" : "locked",
    hasCred     ? "active"   : "locked",
    hasCred     ? "active"   : "locked",
  ]

  const steps = [
    { num: "01", title: "Install Sui Wallet",      est: "2 min" },
    { num: "02", title: "Connect & Fund",          est: "2 min" },
    { num: "03", title: "Bond 1 SUI",              est: "1 min" },
    { num: "04", title: "Install Docker Desktop",  est: "5 min" },
    { num: "05", title: "Launch your keeper",      est: "1 min" },
  ]

  const scrollTo = (i: number) =>
    stepRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" })

  const register = () => {
    setTx({ status: "pending" })
    const t = new Transaction()
    const [coin] = t.splitCoins(t.gas, [t.pure.u64(1_000_000_000)])
    t.moveCall({
      target: `${REGISTRY_PKG}::credential::register`,
      arguments: [coin, t.object(CLOCK_ID)],
    })
    signAndExecute(
      { transaction: t },
      {
        onSuccess: r => {
          setTx({ status: "success", digest: r.digest })
          setTimeout(() => queryClient.invalidateQueries(), 2000)
        },
        onError: e => setTx({ status: "error", message: e.message ?? "Transaction failed" }),
      }
    )
  }

  const credId = credential?.id ?? ""

  return (
    <div className="join-page">

      {/* Title bar */}
      <div className="join-titlebar">
        <div className="join-titlebar-inner">
          <button className="join-back" onClick={onBack}>
            ← Dashboard
          </button>
          <div className="join-titlebar-text">
            <h1 className="join-titlebar-h1">Run a Pharos Keeper</h1>
            <p className="join-titlebar-sub">
              5 steps · ~10 minutes · open to anyone
            </p>
          </div>
          <div className="join-titlebar-badge">
            <span className="pulse" />
            Testnet
          </div>
        </div>
      </div>

      <div className="join-layout">

        {/* ── Sidebar ── */}
        <aside className="join-sidebar">
          <div className="join-sidebar-label">Progress</div>
          {steps.map((s, i) => (
            <button
              key={i}
              className={`join-step-nav ${statuses[i]}`}
              onClick={() => scrollTo(i)}
            >
              <div className="join-step-circle">
                {statuses[i] === "complete" ? "✓" : s.num}
              </div>
              <div className="join-step-nav-body">
                <div className="join-step-nav-title">{s.title}</div>
                <div className="join-step-nav-est">{s.est}</div>
              </div>
            </button>
          ))}

          <div className="join-sidebar-divider" />
          <div className="join-sidebar-info">
            <div className="join-sidebar-info-title">What you earn</div>
            <div className="join-sidebar-info-val">0.10 SUI</div>
            <div className="join-sidebar-info-sub">per settled position</div>
          </div>
        </aside>

        {/* ── Step content ── */}
        <div className="join-content">

          {/* ──── Step 1: Sui Wallet ──── */}
          <div
            ref={el => { stepRefs.current[0] = el }}
            className={`join-card ${statuses[0]}`}
          >
            <div className="join-card-inner">
              <div className="join-step-tag">Step 01 · 2 min</div>
              <h2 className="join-step-h2">Install Sui Wallet</h2>
              <p className="join-step-desc">
                The Sui Wallet browser extension lets you hold SUI, sign on-chain transactions,
                and interact with this dashboard. Install it once — it works across all Sui apps.
              </p>

              {hasWallet ? (
                <div className="join-complete-row">
                  <span className="join-complete-badge">✓ Sui Wallet detected</span>
                </div>
              ) : (
                <div className="join-action-group">
                  <a
                    href="https://chromewebstore.google.com/detail/sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil"
                    target="_blank" rel="noopener"
                    className="join-action-btn"
                  >
                    Install Sui Wallet ↗
                  </a>
                  <span className="join-action-note">Refresh this page after installing</span>
                </div>
              )}
            </div>
            {statuses[0] === "complete" && <div className="join-card-bar" />}
          </div>

          {/* ──── Step 2: Connect & Fund ──── */}
          <div
            ref={el => { stepRefs.current[1] = el }}
            className={`join-card ${statuses[1]}`}
          >
            <div className="join-card-inner">
              <div className="join-step-tag">Step 02 · 2 min</div>
              <h2 className="join-step-h2">Connect & Fund Your Wallet</h2>
              <p className="join-step-desc">
                Connect your wallet to this dashboard, then grab free testnet SUI from the faucet.
                You need at least <strong style={{ color: "var(--text)" }}>1.1 SUI</strong> —
                1 for the keeper bond and a small amount for gas fees.
              </p>

              {isConnected ? (
                <div className="join-complete-row">
                  <span className="join-complete-badge">
                    ✓ {account.address.slice(0, 10)}…{account.address.slice(-6)}
                  </span>
                  <a href="https://faucet.sui.io" target="_blank" rel="noopener" className="join-link">
                    Top up from faucet ↗
                  </a>
                </div>
              ) : (
                <div className="join-action-group">
                  {!hasWallet ? (
                    <span className="join-locked-note">Complete step 1 first</span>
                  ) : wallets.length === 1 ? (
                    <button className="join-action-btn" onClick={() => connect({ wallet: wallets[0] })}>
                      Connect {wallets[0].name}
                    </button>
                  ) : (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {wallets.map(w => (
                        <button key={w.name} className="join-action-btn" onClick={() => connect({ wallet: w })}>
                          {w.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <a href="https://faucet.sui.io" target="_blank" rel="noopener" className="join-link">
                    Get testnet SUI ↗
                  </a>
                </div>
              )}
            </div>
            {statuses[1] === "complete" && <div className="join-card-bar" />}
          </div>

          {/* ──── Step 3: Bond ──── */}
          <div
            ref={el => { stepRefs.current[2] = el }}
            className={`join-card ${statuses[2]}`}
          >
            <div className="join-card-inner">
              <div className="join-step-tag">Step 03 · 1 min</div>
              <h2 className="join-step-h2">Bond 1 SUI on-chain</h2>
              <p className="join-step-desc">
                Bonding creates your{" "}
                <span className="mono" style={{ fontSize: 13, color: "var(--accent)" }}>KeeperCredential</span>{" "}
                — a non-custodial on-chain identity that ties your keeper node to your wallet.
                The bond is locked while you operate and <strong style={{ color: "var(--text)" }}>fully refundable</strong> by
                calling <span className="mono" style={{ fontSize: 12 }}>unbond</span> at any time.
              </p>

              {hasCred ? (
                <div>
                  <div className="join-complete-row" style={{ marginBottom: 20 }}>
                    <span className="join-complete-badge">✓ Credential active</span>
                    <a href={`${EXPLORER_BASE}/object/${credential.id}`} target="_blank" rel="noopener" className="join-link">
                      View on SuiScan ↗
                    </a>
                  </div>
                  <div className="join-cred-box">
                    <div className="join-cred-box-label">KeeperCredential ID</div>
                    <div className="join-cred-id-row">
                      <span className="join-cred-id">{credential.id}</span>
                      <CopyBtn text={credential.id} label="Copy ID" />
                    </div>
                    <div className="join-cred-meta">
                      <div className="join-cred-meta-item">
                        <span className="join-cred-meta-key">Bond</span>
                        <span className="join-cred-meta-val">{(credential.bondedAmount / 1e9).toFixed(2)} SUI</span>
                      </div>
                      <div className="join-cred-meta-item">
                        <span className="join-cred-meta-key">Jobs completed</span>
                        <span className="join-cred-meta-val">{credential.jobsCompleted.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="join-bond-table">
                    <div className="join-bond-row">
                      <span className="join-bond-key">Bond amount</span>
                      <span className="join-bond-val">1.00 SUI</span>
                    </div>
                    <div className="join-bond-row">
                      <span className="join-bond-key">Refundable</span>
                      <span className="join-bond-val" style={{ color: "var(--green)" }}>Yes, anytime</span>
                    </div>
                    <div className="join-bond-row">
                      <span className="join-bond-key">Activation</span>
                      <span className="join-bond-val">Instant on testnet</span>
                    </div>
                  </div>

                  {tx.status === "error" && (
                    <div className="error-box">{tx.message}</div>
                  )}
                  {tx.status === "success" && (
                    <div className="tx-success" style={{ marginBottom: 16 }}>
                      <span>✓</span>
                      <span>
                        Submitted{" "}
                        <a href={`${EXPLORER_BASE}/tx/${tx.digest}`} target="_blank" rel="noopener">
                          {tx.digest.slice(0, 10)}…
                        </a>
                        {" "}— loading credential…
                      </span>
                    </div>
                  )}

                  {!isConnected ? (
                    <div className="join-locked-note">Connect your wallet in step 2 first</div>
                  ) : (
                    <button
                      className={`join-action-btn primary ${tx.status === "pending" ? "loading" : ""}`}
                      onClick={register}
                      disabled={tx.status === "pending" || tx.status === "success" || credLoading}
                    >
                      {tx.status === "pending" ? (
                        <span className="join-spinner" />
                      ) : (
                        "Bond 1 SUI  →  Register as Keeper"
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
            {statuses[2] === "complete" && <div className="join-card-bar" />}
          </div>

          {/* ──── Step 4: Docker ──── */}
          <div
            ref={el => { stepRefs.current[3] = el }}
            className={`join-card ${statuses[3]}`}
          >
            <div className="join-card-inner">
              <div className="join-step-tag">Step 04 · 5 min</div>
              <h2 className="join-step-h2">Install Docker Desktop</h2>
              <p className="join-step-desc">
                Docker runs your keeper — and its database — in a fully isolated container.
                No runtimes, no dependencies, no config. Install once and it handles everything.
              </p>

              <div className="join-docker-grid">
                <a
                  href="https://desktop.docker.com/mac/main/arm64/Docker.dmg"
                  target="_blank" rel="noopener"
                  className="join-docker-card"
                >
                  <div className="join-docker-os">macOS</div>
                  <div className="join-docker-arch">Apple Silicon</div>
                  <div className="join-docker-dl">Download .dmg ↓</div>
                </a>
                <a
                  href="https://desktop.docker.com/mac/main/amd64/Docker.dmg"
                  target="_blank" rel="noopener"
                  className="join-docker-card"
                >
                  <div className="join-docker-os">macOS</div>
                  <div className="join-docker-arch">Intel</div>
                  <div className="join-docker-dl">Download .dmg ↓</div>
                </a>
                <a
                  href="https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"
                  target="_blank" rel="noopener"
                  className="join-docker-card"
                >
                  <div className="join-docker-os">Windows</div>
                  <div className="join-docker-arch">x64</div>
                  <div className="join-docker-dl">Download .exe ↓</div>
                </a>
              </div>

              <div className="join-action-note" style={{ marginTop: 16 }}>
                Open Docker Desktop after install and wait for the engine to start (the whale icon stops animating), then move to step 5.
              </div>
            </div>
          </div>

          {/* ──── Step 5: Launch ──── */}
          <div
            ref={el => { stepRefs.current[4] = el }}
            className={`join-card ${statuses[4]}`}
          >
            <div className="join-card-inner">
              <div className="join-step-tag">Step 05 · 1 min</div>
              <h2 className="join-step-h2">Launch your keeper</h2>
              <p className="join-step-desc">
                Clone the repository and run the interactive setup script.
                It asks three questions and starts everything automatically.
              </p>

              <div className="join-launch-steps">

                <div className="join-launch-item">
                  <div className="join-launch-num">1</div>
                  <div className="join-launch-body">
                    <div className="join-launch-label">Clone the keeper repository</div>
                    <CodeBlock label="terminal" code={"git clone https://github.com/cosmatudor/Pharos-Sui-Overflow-2026\ncd Pharos-Sui-Overflow-2026/keeper"} />
                  </div>
                </div>

                <div className="join-launch-item">
                  <div className="join-launch-num">2</div>
                  <div className="join-launch-body">
                    <div className="join-launch-label">Run the setup wizard</div>
                    <CodeBlock label="terminal" code="./setup.sh" />

                    <div className="join-prompts">
                      <div className="join-prompt-row">
                        <span className="join-prompt-q">Network?</span>
                        <span className="join-prompt-a">Testnet</span>
                      </div>
                      <div className="join-prompt-row">
                        <span className="join-prompt-q">Private key?</span>
                        <div>
                          <div className="join-prompt-a">Export from Sui CLI:</div>
                          <code className="join-prompt-cmd">sui keytool export --key-identity &lt;alias&gt;</code>
                        </div>
                      </div>
                      <div className="join-prompt-row">
                        <span className="join-prompt-q">Credential ID?</span>
                        <span className="join-prompt-a">Paste from Step 3 ↓</span>
                      </div>
                    </div>

                    {credId ? (
                      <div className="join-cred-box" style={{ marginTop: 16 }}>
                        <div className="join-cred-box-label">
                          ✓ Your Credential ID — copy and paste when setup asks
                        </div>
                        <div className="join-cred-id-row">
                          <span className="join-cred-id">{credId}</span>
                          <CopyBtn text={credId} label="Copy" />
                        </div>
                      </div>
                    ) : (
                      <div className="join-locked-note" style={{ marginTop: 14 }}>
                        Your credential ID will appear here after completing step 3
                      </div>
                    )}
                  </div>
                </div>

                <div className="join-launch-item">
                  <div className="join-launch-num">3</div>
                  <div className="join-launch-body">
                    <div className="join-launch-label">Watch your keeper run</div>
                    <CodeBlock label="terminal" code="docker compose logs -f keeper" />
                    <div className="join-action-note">
                      You will see <span className="mono" style={{ fontSize: 11 }}>keeper running</span> then scan logs.
                      Your address appears in the network dashboard once you win your first settlement.
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>

          {/* ──── FAQ ──── */}
          <div className="join-faq">
            <div className="join-faq-title">Common questions</div>
            <div className="join-faq-grid">
              <div className="join-faq-item">
                <div className="join-faq-q">Is my private key safe?</div>
                <div className="join-faq-a">
                  Your key is written only to a local <span className="mono" style={{ fontSize: 11 }}>.env</span> file on your machine. It never leaves your device and is never sent to any server. The keeper signs transactions locally.
                </div>
              </div>
              <div className="join-faq-item">
                <div className="join-faq-q">What does the 1 SUI bond do?</div>
                <div className="join-faq-a">
                  It creates your on-chain <span className="mono" style={{ fontSize: 11 }}>KeeperCredential</span> and proves economic commitment. The bond is locked while you operate and fully returned when you call <span className="mono" style={{ fontSize: 11 }}>unbond</span>.
                </div>
              </div>
              <div className="join-faq-item">
                <div className="join-faq-q">Can I run multiple keepers?</div>
                <div className="join-faq-a">
                  Yes. Each keeper needs its own wallet, credential, and directory. Copy the repo to a new folder and run <span className="mono" style={{ fontSize: 11 }}>./setup.sh</span> in each one independently.
                </div>
              </div>
              <div className="join-faq-item">
                <div className="join-faq-q">How do I stop or upgrade?</div>
                <div className="join-faq-a">
                  Stop: <span className="mono" style={{ fontSize: 11 }}>docker compose down</span>.{" "}
                  Upgrade: <span className="mono" style={{ fontSize: 11 }}>docker compose pull && docker compose up -d --build</span>.
                  Your DB state and position history are preserved between restarts.
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
