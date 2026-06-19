import { useState } from "react"
import { useSignAndExecuteTransaction, useConnectWallet, useWallets } from "@mysten/dapp-kit"
import { useQueryClient } from "@tanstack/react-query"
import { Transaction } from "@mysten/sui/transactions"
import type { WalletAccount } from "@mysten/wallet-standard"
import { useKeeperStatus } from "../hooks/useKeeperStatus"
import { REGISTRY_PKG, CLOCK_ID, EXPLORER_BASE } from "../constants"

interface Props {
  account: WalletAccount | null
  rewardPerSettlement: number
}

type TxState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; digest: string }
  | { status: "error"; message: string }

function shortId(id: string) {
  return `${id.slice(0, 10)}…${id.slice(-6)}`
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button className={`copy-btn ${copied ? "copied" : ""}`} onClick={copy}>
      {copied ? "✓ Copied" : "Copy"}
    </button>
  )
}

function StepIndicators({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["Connect Wallet", "Bond SUI", "Run Keeper"]
  return (
    <div className="step-indicators">
      {steps.map((label, i) => {
        const num = (i + 1) as 1 | 2 | 3
        const status =
          num < current ? "completed" : num === current ? "active" : ""
        return (
          <div key={label} className={`step-indicator ${status}`}>
            <div className="step-num-circle">
              {num < current ? "✓" : num}
            </div>
            <span className="step-label-sm">{label}</span>
          </div>
        )
      })}
    </div>
  )
}

function Step1Connect() {
  const wallets = useWallets()
  const { mutate: connect } = useConnectWallet()

  return (
    <div className="step-content">
      <div className="step-content-title">Connect your Sui wallet</div>
      <div className="step-content-desc">
        Connect a Sui-compatible wallet to register as a keeper. Your private key never leaves your device.
      </div>
      {wallets.length === 0 ? (
        <>
          <div className="error-box">
            No Sui wallet detected in your browser.
          </div>
          <a
            href="https://chrome.google.com/webstore/detail/sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil"
            target="_blank"
            rel="noopener"
          >
            <button className="btn-primary">
              Install Sui Wallet ↗
            </button>
          </a>
        </>
      ) : wallets.length === 1 ? (
        <button className="btn-connect" onClick={() => connect({ wallet: wallets[0] })}>
          Connect {wallets[0].name}
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {wallets.map(w => (
            <button key={w.name} className="btn-connect" onClick={() => connect({ wallet: w })}>
              Connect {w.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Step2Bond({ address, rewardPerSettlement }: { address: string; rewardPerSettlement: number }) {
  const [tx, setTx] = useState<TxState>({ status: "idle" })
  const queryClient = useQueryClient()
  const { mutate: signAndExecute } = useSignAndExecuteTransaction()

  const register = () => {
    setTx({ status: "pending" })
    const transaction = new Transaction()
    const [coin] = transaction.splitCoins(transaction.gas, [transaction.pure.u64(1_000_000_000)])
    transaction.moveCall({
      target: `${REGISTRY_PKG}::credential::register`,
      arguments: [coin, transaction.object(CLOCK_ID)],
    })

    signAndExecute(
      { transaction },
      {
        onSuccess: result => {
          setTx({ status: "success", digest: result.digest })
          // Trigger re-fetch of owned objects so credential appears
          setTimeout(() => queryClient.invalidateQueries(), 2000)
        },
        onError: err => {
          setTx({ status: "error", message: err.message ?? "Transaction failed" })
        },
      }
    )
  }

  return (
    <div className="step-content">
      <div className="step-content-title">Bond 1 SUI to register</div>
      <div className="step-content-desc">
        Bonding SUI creates your on-chain{" "}
        <span className="mono" style={{ fontSize: 12, color: "var(--accent)" }}>KeeperCredential</span>{" "}
        and proves economic commitment to honest operation.
        The bond is returned when you unbond. Instant activation on testnet.
      </div>

      <div className="wallet-status-row">
        <div>
          <div className="wallet-status-label">Connected wallet</div>
          <div className="wallet-status-addr">{shortId(address)}</div>
        </div>
        <div style={{ fontSize: 12, color: "var(--green)", fontWeight: 600 }}>● Connected</div>
      </div>

      <div className="bond-info">
        <span className="bond-info-icon">🔒</span>
        <div>
          <div className="bond-info-label">Bond amount</div>
          <div className="bond-info-value">1.00 SUI</div>
          <div className="bond-info-note">
            Refundable · Earns {(rewardPerSettlement / 1e9).toFixed(2)} SUI per settlement
          </div>
        </div>
      </div>

      {tx.status === "error" && (
        <div className="error-box">{tx.message}</div>
      )}

      {tx.status === "success" && (
        <div className="tx-success">
          <span>✓</span>
          <div>
            Transaction submitted.{" "}
            <a href={`${EXPLORER_BASE}/tx/${tx.digest}`} target="_blank" rel="noopener">
              {shortId(tx.digest)}
            </a>
            <br />
            <span style={{ color: "var(--muted2)" }}>Fetching your credential…</span>
          </div>
        </div>
      )}

      <button
        className={`btn-primary ${tx.status === "pending" ? "loading" : ""}`}
        onClick={register}
        disabled={tx.status === "pending" || tx.status === "success"}
      >
        {tx.status === "pending" ? "" : "Register as Keeper  →  1 SUI"}
      </button>
    </div>
  )
}

function Step3Run({ address, credentialId, jobsCompleted, bondedAmount, rewardPerSettlement }: {
  address: string
  credentialId: string
  jobsCompleted: number
  bondedAmount: number
  rewardPerSettlement: number
}) {
  const envConfig = `KEEPER_CREDENTIAL_ID=${credentialId}`
  const earnings = (jobsCompleted * rewardPerSettlement) / 1e9

  return (
    <div className="step-content">
      <div className="credential-card">
        <div className="credential-header">
          <div className="credential-badge">
            <span>✓</span> Active Keeper
          </div>
        </div>
        <div className="credential-rows">
          <div className="credential-row">
            <span className="credential-key">Wallet</span>
            <span className="credential-val">{shortId(address)}</span>
          </div>
          <div className="credential-row">
            <span className="credential-key">Credential ID</span>
            <span className="credential-val">
              <a
                href={`${EXPLORER_BASE}/object/${credentialId}`}
                target="_blank"
                rel="noopener"
                style={{ color: "var(--accent)" }}
              >
                {shortId(credentialId)}
              </a>
            </span>
          </div>
          <div className="credential-row">
            <span className="credential-key">Bond</span>
            <span className="credential-val">{(bondedAmount / 1e9).toFixed(2)} SUI</span>
          </div>
          <div className="credential-row">
            <span className="credential-key">Jobs completed</span>
            <span className="credential-val">{jobsCompleted.toLocaleString()}</span>
          </div>
          {earnings > 0 && (
            <div className="credential-row">
              <span className="credential-key">Earned</span>
              <span className="credential-val green">{earnings.toFixed(3)} SUI</span>
            </div>
          )}
        </div>
      </div>

      <div className="step-content-desc" style={{ marginBottom: 16 }}>
        Add your credential ID to the keeper&apos;s <span className="mono" style={{ fontSize: 12 }}>.env</span> and start earning.
      </div>

      <div className="code-snippet">
        <div className="code-snippet-header">
          <span>.env configuration</span>
          <CopyButton text={envConfig} />
        </div>
        <code className="snippet">{envConfig}</code>
      </div>

      <div className="code-snippet" style={{ marginBottom: 20 }}>
        <div className="code-snippet-header">
          <span>start earning</span>
        </div>
        <code className="snippet">{"make up   # start postgres + kafka\nmake run  # start the keeper"}</code>
      </div>

      <div style={{ fontSize: 12, color: "var(--muted2)", lineHeight: 1.6 }}>
        The keeper scans all settled oracles every 30s, calls{" "}
        <span className="mono" style={{ fontSize: 11 }}>redeem_permissionless</span> +{" "}
        <span className="mono" style={{ fontSize: 11 }}>record_settlement</span> atomically,
        and earns <strong style={{ color: "var(--text)" }}>{(rewardPerSettlement / 1e9).toFixed(2)} SUI</strong> per settlement.
      </div>
    </div>
  )
}

export default function RegisterFlow({ account, rewardPerSettlement }: Props) {
  const { credential, loading: credLoading } = useKeeperStatus(account?.address)

  const currentStep: 1 | 2 | 3 = !account ? 1 : !credential ? 2 : 3

  return (
    <div className="register-card">
      <div className="register-hero">
        <div className="register-hero-title">Become a Keeper</div>
        <div className="register-hero-sub">
          Bond 1 SUI, run the keeper node, and earn{" "}
          {rewardPerSettlement > 0 ? `${(rewardPerSettlement / 1e9).toFixed(2)} SUI` : "rewards"}{" "}
          for every DeepBook Predict position you settle.
          No whitelist. No permission needed.
        </div>
      </div>

      <StepIndicators current={currentStep} />

      {currentStep === 1 && <Step1Connect />}

      {currentStep === 2 && !credLoading && (
        <Step2Bond address={account!.address} rewardPerSettlement={rewardPerSettlement} />
      )}

      {currentStep === 2 && credLoading && (
        <div className="step-content">
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Checking your keeper status…</div>
        </div>
      )}

      {currentStep === 3 && credential && (
        <Step3Run
          address={account!.address}
          credentialId={credential.id}
          jobsCompleted={credential.jobsCompleted}
          bondedAmount={credential.bondedAmount}
          rewardPerSettlement={rewardPerSettlement}
        />
      )}
    </div>
  )
}
