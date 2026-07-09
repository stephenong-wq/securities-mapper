"use client"
import { useState, useEffect, useCallback, useRef } from "react"
import { MODELS } from "@/lib/types"
import type { ModelId, MappedSecurity, MorningstarRow, ModelUniverseRow } from "@/lib/types"
import type { ImportResult, AccountData, ProcessedHolding } from "@/lib/importParser"
import type { TransitionSummary, TradeRow } from "@/lib/transitionEngine"

// ─── Status config ─────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  mapped:        { label: "Mapped",         bg: "#001e18", color: "#00f0c0", dot: "#00f0c0" },
  split:         { label: "Split",          bg: "#001030", color: "#4488ff", dot: "#4488ff" },
  "not-in-model":{ label: "No Model Match", bg: "#001828", color: "#00c8ff", dot: "#00c8ff" },
  "no-match":    { label: "Unknown",        bg: "#1e0018", color: "#ff4488", dot: "#ff4488" },
}

function styleColor(style: string) {
  if (style.includes("Value"))    return { bg: "#001428", color: "#00c8ff" }
  if (style.includes("Growth"))   return { bg: "#001030", color: "#4488ff" }
  if (style.includes("Emerging")) return { bg: "#001828", color: "#00d4ff" }
  if (style.includes("Bond") || style.includes("Protected")) return { bg: "#001e18", color: "#00f0c0" }
  if (style.includes("Real Estate") || style.includes("Commodities")) return { bg: "#0a0020", color: "#8855ff" }
  return { bg: "#0a1828", color: "#7a9cc0" }
}

function fmt$(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
}
function fmtPct(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`
}

// ─── Manual CSV export ─────────────────────────────────────────────────────────
function exportManualCSV(results: MappedSecurity[], accountId: string) {
  const rows = [["Account ID", "Targeted", "Equivalent", "Equivalent Buy Priority", "Equivalent Sell Priority", "Delete"]]
  results.forEach(r => {
    if (r.mappings.length === 0) return
    r.mappings.forEach(m => {
      rows.push([accountId, m.ticker, r.inputTicker, "Do Not Buy", "Default", ""])
    })
  })
  downloadCSV(rows, `AccountEquivalent-${accountId || "export"}-${new Date().toISOString().slice(0,10)}.csv`)
}

// ─── Import CSV export ─────────────────────────────────────────────────────────
function exportImportCSV(processedAccounts: { accountId: string; processed: ProcessedHolding[] }[]) {
  const rows = [["Account ID", "Targeted", "Equivalent", "Equivalent Buy Priority", "Equivalent Sell Priority", "Delete"]]
  processedAccounts.forEach(({ accountId, processed }) => {
    processed.filter(p => (p.action === "map" || p.action === "sell-gain") && p.matches.length > 0).forEach(p => {
      p.matches.forEach(m => {
        rows.push([accountId, m.ticker, p.holding.ticker, "Do Not Buy", "Default", ""])
      })
    })
  })
  const date = new Date().toISOString().slice(0,10)
  const ids = processedAccounts.map(a => a.accountId).join("-")
  downloadCSV(rows, `AccountEquivalent-${ids}-${date}.csv`)
}
function downloadCSV(rows: string[][], filename: string) {
  const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url; a.download = filename; a.click()
}

// ─── PDF / Print Export ───────────────────────────────────────────────────────
function exportTransitionPDF(transition: TransitionSummary, trades: TradeRow[], clientName: string) {
  const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
  const fmtD = (n: number) => n === 0 ? "$0.00" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })
  const fmtPct = (n: number) => `${(n*100).toFixed(1)}%`
  const sells = trades.filter(t => t.tradeType === "sell").sort((a,b) => a.tradeAmount - b.tradeAmount).slice(0,10)
  const buys  = trades.filter(t => t.tradeType === "buy").sort((a,b) => b.tradeAmount - a.tradeAmount).slice(0,10)
  const name = clientName || transition.clientName

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Transition Analysis</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:Georgia,serif;font-size:11px;color:#2a2a2a;padding:48px}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:18px;border-bottom:2px solid #c8b89a}
.logo{font-size:26px;font-weight:700;font-family:sans-serif}.title{font-size:20px;font-weight:700;margin-bottom:5px}
.sub{font-size:11px;color:#666;margin-bottom:2px}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:28px}
.metric{border:1px solid #ddd;padding:12px 14px}.metric-label{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:6px;font-family:sans-serif}
.metric-value{font-size:18px;font-weight:700}.red{color:#c0392b}.green{color:#1a7a4a}
.section{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#888;border-bottom:2px solid #c8b89a;padding-bottom:5px;margin-bottom:10px;font-family:sans-serif}
table{width:100%;border-collapse:collapse;margin-bottom:24px}
th{background:#3d3427;color:#fff;padding:7px 9px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.06em;font-family:sans-serif}
td{padding:6px 9px;border-bottom:1px solid #eee;font-size:10px}tr:nth-child(even) td{background:#f9f7f4}
.right{text-align:right}.tax-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px}
.tax-box{border:1px solid #ddd;padding:14px}.tax-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;background:#3d3427;color:#fff;padding:5px 9px;margin:-14px -14px 10px;font-family:sans-serif}
.tax-row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f0ece6;font-size:10px}
.footer{margin-top:28px;padding-top:10px;border-top:1px solid #ddd;font-size:9px;color:#999;font-family:sans-serif}
.page2{page-break-before:always;padding-top:48px}
@media print{.page2{page-break-before:always}}
</style></head><body>
<div class="header"><div>
<div class="title">Portfolio Transition Analysis</div>
<div class="sub">Client: ${name}</div>
<div class="sub">Prepared by Savvy Advisors · ${transition.date}</div>
<div class="sub" style="margin-top:4px">Target Model: ${transition.modelName}</div>
</div><div class="logo">Savvy</div></div>
<div class="metrics">
<div class="metric"><div class="metric-label">Total Value</div><div class="metric-value">${fmt(transition.totalValue)}</div></div>
<div class="metric"><div class="metric-label">Transition G/L</div><div class="metric-value ${transition.totalTradeGL < 0 ? "red" : ""}">${fmtD(transition.totalTradeGL)}</div></div>
<div class="metric"><div class="metric-label">Estimated Tax</div><div class="metric-value red">${fmtD(transition.estimatedTax)}</div></div>
<div class="metric"><div class="metric-label">Tax Impact</div><div class="metric-value red">${(transition.taxImpactPct*100).toFixed(2)}%</div></div>
</div>
<div class="section">Asset Allocation</div>
<table><tr><th>Asset Class</th><th class="right">Current %</th><th class="right">Target %</th><th class="right">Post-Trade %</th><th class="right">Trade Amount</th></tr>
${transition.assetAllocation.map(r => `<tr><td>${r.assetClass}</td><td class="right">${fmtPct(r.currentPct)}</td><td class="right">${fmtPct(r.targetPct)}</td><td class="right" style="font-weight:700;color:#1a5c8a">${fmtPct(r.postTradePct)}</td><td class="right ${r.tradeAmount<0?"red":"green"}">${r.tradeAmount>=0?"+":""}${fmt(r.tradeAmount)}</td></tr>`).join("")}
</table>
<div class="tax-grid">
<div class="tax-box"><div class="tax-title">Pre-Transition</div>
<div class="tax-row"><span>Unrealized G/L</span><span>${fmtD(transition.ltGains+transition.stGains+transition.losses)}</span></div>
<div class="tax-row"><span>Gains</span><span>${fmtD(transition.ltGains+transition.stGains)}</span></div>
<div class="tax-row"><span>Losses</span><span class="red">${fmtD(transition.losses)}</span></div>
</div>
<div class="tax-box"><div class="tax-title">Post-Transition</div>
<div class="tax-row" style="font-weight:600"><span>Realized Gains</span></div>
<div class="tax-row"><span>&nbsp;&nbsp;Long Term</span><span>${fmtD(transition.ltGains)}</span></div>
<div class="tax-row"><span>&nbsp;&nbsp;Short Term</span><span>${fmtD(transition.stGains)}</span></div>
<div class="tax-row"><span>Net Realized G/L</span><span>${fmtD(transition.totalTradeGL)}</span></div>
<div class="tax-row"><span>Estimated Tax</span><span class="red">${fmtD(transition.estimatedTax)}</span></div>
<div class="tax-row"><span># of Trades</span><span>${transition.numTrades}</span></div>
</div></div>
<div class="footer">This analysis is for internal advisory use only. Tax estimates are approximate and do not constitute tax advice.</div>
<div class="page2">
<div class="header"><div><div class="title">Detailed Trade Analysis</div><div class="sub">Client: ${name}</div><div class="sub">Prepared by Savvy Advisors · ${transition.date}</div></div><div class="logo">Savvy</div></div>
<div class="section">Accounts</div>
<table><tr><th>Account</th><th>Reg Type</th><th class="right">Account Value</th></tr>
${transition.accounts.map(a => `<tr><td>${a.accountNumber}</td><td>${a.regType||"—"}</td><td class="right">${fmt(a.value)}</td></tr>`).join("")}
</table>
<div class="section">Top 10 Buys</div>
<table><tr><th>Account</th><th>Ticker</th><th>Security Name</th><th class="right">Trade $</th></tr>
${buys.map(t => `<tr><td>${t.accountNumber}</td><td>${t.ticker}</td><td>${t.securityName}</td><td class="right green">+${fmt(t.tradeAmount)}</td></tr>`).join("")}
</table>
<div class="section">Top 10 Sells</div>
<table><tr><th>Account</th><th>Ticker</th><th>Security Name</th><th class="right">Trade $</th><th class="right">G/L $</th></tr>
${sells.map(t => `<tr><td>${t.accountNumber}</td><td>${t.ticker}</td><td>${t.securityName}</td><td class="right red">${fmt(t.tradeAmount)}</td><td class="${t.realizedGL<0?"red":t.realizedGL>0?"green":""} right">${t.realizedGL!==0?fmtD(t.realizedGL):"$0.00"}</td></tr>`).join("")}
</table>
<div class="footer">This analysis is for internal advisory use only. Tax estimates are approximate and do not constitute tax advice.</div>
</div></body></html>`

  const w = window.open("", "_blank")
  if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500) }
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function Home() {
  const [activeTab, setActiveTab] = useState<"manual" | "import">("manual")

  // Shared data
  const [msData, setMsData] = useState<MorningstarRow[]>([])
  const [universeData, setUniverseData] = useState<ModelUniverseRow[]>([])
  const [usingBlob, setUsingBlob] = useState(false)
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  // Manual tab
  const [selectedModel, setSelectedModel] = useState<ModelId>("stp")
  const [tickerInput, setTickerInput] = useState("")
  const [manualResults, setManualResults] = useState<MappedSecurity[] | null>(null)
  const [manualLoading, setManualLoading] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportAccountId, setExportAccountId] = useState("")

  // Import tab
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [processedAccounts, setProcessedAccounts] = useState<{ accountId: string; accountNumber: string; modelName: string; processed: ProcessedHolding[] }[] | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [gainsBudget, setGainsBudget] = useState("")
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [showImportExportModal, setShowImportExportModal] = useState(false)
  const [importExportAccountId, setImportExportAccountId] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)

  // Transition tab state
  const [transition, setTransition] = useState<TransitionSummary | null>(null)
  const [transitionLoading, setTransitionLoading] = useState(false)
  const [transitionError, setTransitionError] = useState<string | null>(null)
  const [clientName, setClientName] = useState("")
  const [transitionBudget, setTransitionBudget] = useState("")
  const [editedTrades, setEditedTrades] = useState<TradeRow[]>([])
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set())
  const transitionFileRef = useRef<HTMLInputElement>(null)
  const [transitionFile, setTransitionFile] = useState<File | null>(null)

  useEffect(() => {
    fetch("/api/data")
      .then(r => r.json())
      .then(d => { setMsData(d.msData); setUniverseData(d.universeData); setUsingBlob(d.usingBlob); if (d.error) setDataError(d.error) })
      .catch(() => setDataError("Failed to load reference data"))
      .finally(() => setDataLoading(false))
  }, [])

  const handleManualMap = useCallback(async () => {
    const tickers = tickerInput.split(/[\n,]+/).map(t => t.trim().toUpperCase()).filter(Boolean)
    if (!tickers.length) return
    setManualLoading(true); setManualResults(null)
    try {
      const res = await fetch("/api/map", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tickers, modelId: selectedModel, msData, universeData }) })
      const data = await res.json()
      setManualResults(data.results)
    } finally { setManualLoading(false) }
  }, [tickerInput, selectedModel, msData, universeData])

  const handleImport = useCallback(async (file: File) => {
    setImportLoading(true); setImportError(null); setImportResult(null); setProcessedAccounts(null)
    try {
      const formData = new FormData()
      formData.append("file", file)
      if (gainsBudget) formData.append("gainsBudget", gainsBudget)
      const res = await fetch("/api/import", { method: "POST", body: formData })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setImportResult(data.importResult)
      setProcessedAccounts(data.processedAccounts)
      if (data.processedAccounts?.length > 0) setSelectedAccountId(data.processedAccounts[0].accountId)
    } catch (e) {
      setImportError(String(e))
    } finally { setImportLoading(false) }
  }, [gainsBudget])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleImport(file)
  }

  const handleReprocess = useCallback(async () => {
    if (!uploadedFile) return
    setImportLoading(true); setImportError(null); setProcessedAccounts(null)
    try {
      const formData = new FormData()
      formData.append("file", uploadedFile)
      if (gainsBudget) formData.append("gainsBudget", gainsBudget)
      const res = await fetch("/api/import", { method: "POST", body: formData })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setProcessedAccounts(data.processedAccounts)
      if (data.processedAccounts?.length > 0) setSelectedAccountId(data.processedAccounts[0].accountId)
    } catch (e) {
      setImportError(String(e))
    } finally { setImportLoading(false) }
  }, [uploadedFile, gainsBudget])

  // ─── Transition handlers ───────────────────────────────────────────────────
  const handleTransitionImport = async (file: File) => {
    setTransitionFile(file)
    setTransitionLoading(true); setTransitionError(null); setTransition(null); setEditedTrades([])
    try {
      const formData = new FormData()
      formData.append("file", file)
      if (transitionBudget) formData.append("gainsBudget", transitionBudget)
      if (clientName) formData.append("clientName", clientName)
      const res = await fetch("/api/transition", { method: "POST", body: formData })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setTransition(data.transition)
      setEditedTrades(data.transition.trades)
      // Default: expand all asset classes
      const classes = new Set<string>(data.transition.trades.map((t: TradeRow) => t.assetClass))
      setExpandedClasses(classes)
    } catch (e) { setTransitionError(String(e)) }
    finally { setTransitionLoading(false) }
  }

  const handleTransitionReprocess = async () => {
    if (!transitionFile) return
    setTransitionLoading(true); setTransitionError(null)
    try {
      const formData = new FormData()
      formData.append("file", transitionFile)
      if (transitionBudget) formData.append("gainsBudget", transitionBudget)
      if (clientName) formData.append("clientName", clientName)
      const res = await fetch("/api/transition", { method: "POST", body: formData })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setTransition(data.transition)
      setEditedTrades(data.transition.trades)
      const classes = new Set<string>(data.transition.trades.map((t: TradeRow) => t.assetClass))
      setExpandedClasses(classes)
    } catch (e) { setTransitionError(String(e)) }
    finally { setTransitionLoading(false) }
  }

  const updateTrade = (id: string, field: string, value: string | number | boolean) => {
    setEditedTrades(prev => prev.map(t => {
      if (t.id !== id) return t
      const updated = { ...t, [field]: value, userOverride: true }
      // Recalc tax if ticker or GL changed
      if (field === "realizedGL") {
        const gl = Number(value)
        updated.estimatedTax = gl > 0
          ? (updated.realizedGLLT > 0 ? updated.realizedGLLT * 0.20 : 0) + (updated.realizedGLST > 0 ? updated.realizedGLST * 0.37 : 0)
          : 0
      }
      return updated
    }))
  }

  const toggleClass = (assetClass: string) => {
    setExpandedClasses(prev => {
      const next = new Set(prev)
      if (next.has(assetClass)) next.delete(assetClass)
      else next.add(assetClass)
      return next
    })
  }

  const selectedModelInfo = MODELS.find(m => m.id === selectedModel)!
  const selectedAccount = processedAccounts?.find(a => a.accountId === selectedAccountId) || processedAccounts?.[0] || null
  const processed = selectedAccount?.processed || null
  const manualStatusCounts = manualResults ? {
    mapped: manualResults.filter(r => r.status === "mapped").length,
    split:  manualResults.filter(r => r.status === "split").length,
    warn:   manualResults.filter(r => r.status === "not-in-model" || r.status === "no-match").length,
  } : null

  const importCounts = processed ? {
    mapped:    processed.filter(p => p.action === "map").length,
    sellLoss:  processed.filter(p => p.action === "sell-loss").length,
    sellGain:  processed.filter(p => p.action === "sell-gain").length,
    totalGain: processed.filter(p => p.action === "sell-gain").reduce((s, p) => s + (p.gainConsumed || 0), 0),
    totalLoss: processed.filter(p => p.action === "sell-loss").reduce((s, p) => s + p.holding.unrealizedGL, 0),
  } : null

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {/* Manual Export Modal */}
      {showExportModal && (
        <Modal title="Export AccountEquivalent" onClose={() => setShowExportModal(false)}>
          <AccountIdInput value={exportAccountId} onChange={setExportAccountId}
            onConfirm={() => { if (manualResults) { exportManualCSV(manualResults, exportAccountId); setShowExportModal(false) } }}
          />
        </Modal>
      )}
      {/* Header */}
      <header style={{ borderBottom: "1px solid var(--border)", background: "rgba(8,15,24,0.95)", backdropFilter: "blur(12px)", padding: "0 40px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--accent)", letterSpacing: "-0.5px", textShadow: "0 0 20px rgba(0,200,255,0.4)" }}>Securities Mapper</span>
          <span style={{ fontSize: 11, color: "var(--ink-faint)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", textTransform: "uppercase" }}>v1.0</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Tab switcher */}
          <div style={{ display: "flex", background: "var(--surface-sunken)", borderRadius: 8, padding: 3, border: "1px solid var(--border)" }}>
            {(["manual", "import", "transition"] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                padding: "5px 16px", borderRadius: 6, border: "none", cursor: "pointer",
                background: activeTab === tab ? "var(--accent)" : "transparent",
                color: activeTab === tab ? "#000" : "var(--ink-faint)",
                fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono)",
                textTransform: "uppercase", letterSpacing: "0.06em", transition: "all 0.15s",
              }}>
                {tab === "manual" ? "Manual" : tab === "import" ? "Security Mapper" : "Transition"}
              </button>
            ))}
          </div>
          {dataLoading ? (
            <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>Loading…</span>
          ) : (
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: usingBlob ? "var(--green)" : "var(--amber)", background: usingBlob ? "var(--green-light)" : "var(--amber-light)", padding: "3px 10px", borderRadius: 20, border: `1px solid ${usingBlob ? "rgba(0,240,192,0.2)" : "rgba(0,200,255,0.2)"}` }}>
              {usingBlob ? "● Live data" : "● Sample data"}
            </span>
          )}
        </div>
      </header>

      <main style={{ flex: 1, maxWidth: 1200, width: "100%", margin: "0 auto", padding: "40px 40px 80px" }}>
        {dataError && <div style={{ marginBottom: 24, padding: "10px 16px", background: "var(--amber-light)", color: "var(--amber)", borderRadius: 8, fontSize: 13 }}>⚠ {dataError}</div>}

        {/* ── MANUAL TAB ── */}
        {activeTab === "manual" && (
          <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 32, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Model selector */}
              <div className="fade-up" style={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>Select Model</span>
                </div>
                <div style={{ padding: 6 }}>
                  {MODELS.map(m => (
                    <button key={m.id} onClick={() => { setSelectedModel(m.id); setManualResults(null) }}
                      style={{ width: "100%", textAlign: "left", padding: "11px 14px", borderRadius: 7, background: selectedModel === m.id ? "rgba(0,200,255,0.08)" : "transparent", border: selectedModel === m.id ? "1px solid rgba(0,200,255,0.25)" : "1px solid transparent", cursor: "pointer", transition: "all 0.15s" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: selectedModel === m.id ? "var(--accent)" : "var(--ink)" }}>{m.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Ticker input */}
              <div className="fade-up-1" style={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>Input Securities</span>
                </div>
                <div style={{ padding: 14 }}>
                  <textarea value={tickerInput} onChange={e => setTickerInput(e.target.value)}
                    placeholder={"Paste tickers here...\nVTI\nIXUS\nAGG"}
                    rows={10}
                    style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontFamily: "var(--font-mono)", fontSize: 13, background: "var(--surface)", color: "var(--ink)", resize: "vertical", outline: "none", lineHeight: 1.9 }}
                    onFocus={e => { e.target.style.borderColor = "var(--accent)" }}
                    onBlur={e => { e.target.style.borderColor = "var(--border)" }}
                  />
                  <button onClick={handleManualMap} disabled={manualLoading || dataLoading || !tickerInput.trim()}
                    style={{ marginTop: 10, width: "100%", padding: "12px 0", background: manualLoading || dataLoading || !tickerInput.trim() ? "var(--surface-sunken)" : "var(--accent)", color: manualLoading || dataLoading || !tickerInput.trim() ? "var(--ink-faint)" : "#000", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "all 0.15s", boxShadow: !manualLoading && !dataLoading && tickerInput.trim() ? "0 0 20px rgba(0,200,255,0.3)" : "none" }}>
                    {manualLoading ? "Mapping…" : "Run Mapping →"}
                  </button>
                </div>
              </div>

              {/* Legend */}
              <div className="fade-up-2" style={{ padding: "16px 18px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent)", fontFamily: "var(--font-mono)", marginBottom: 12 }}>Status Legend</div>
                {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: cfg.dot, flexShrink: 0, boxShadow: `0 0 6px ${cfg.dot}` }} />
                    <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                      <strong style={{ color: "var(--ink)" }}>{cfg.label}</strong>
                      {key === "mapped" && " — equivalent found in model"}
                      {key === "split" && " — maps to multiple tickers"}
                      {key === "not-in-model" && " — not available in this model"}
                      {key === "no-match" && " — ticker not in Morningstar data"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Manual results */}
            <div className="fade-up-2">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, minHeight: 36 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--ink)" }}>
                    {manualResults ? `${manualResults.length} Securities` : "Results"}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>→ {selectedModelInfo.label}</span>
                </div>
                {manualResults && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {manualStatusCounts && (
                      <div style={{ display: "flex", gap: 6 }}>
                        {manualStatusCounts.mapped > 0 && <Chip label={`${manualStatusCounts.mapped} mapped`} color="#00f0c0" bg="#001e18" glow="#00f0c0" />}
                        {manualStatusCounts.split  > 0 && <Chip label={`${manualStatusCounts.split} split`}   color="#4488ff" bg="#001030" glow="#4488ff" />}
                        {manualStatusCounts.warn   > 0 && <Chip label={`${manualStatusCounts.warn} issues`}   color="#ff4488" bg="#1e0018" glow="#ff4488" />}
                      </div>
                    )}
                    <button onClick={() => { setExportAccountId(""); setShowExportModal(true) }}
                      style={{ padding: "3px 12px", background: "rgba(0,200,255,0.08)", color: "var(--accent)", border: "1px solid rgba(0,200,255,0.25)", borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-mono)" }}>
                      Export
                    </button>
                  </div>
                )}
              </div>

              {!manualResults && !manualLoading && (
                <EmptyState text="Paste tickers and select a model to begin mapping" />
              )}
              {manualLoading && <Skeleton />}
              {manualResults && !manualLoading && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <ResultsHeader />
                  {manualResults.map((r, idx) => {
                    const cfg = STATUS_CONFIG[r.status]
                    return (
                      <div key={r.inputTicker + idx} className="fade-up"
                        style={{ animationDelay: `${idx * 0.03}s`, background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--border-strong)")}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}>
                        {r.mappings.length === 0 && (
                          <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr 1fr 110px", padding: "14px 16px", gap: 12, alignItems: "center" }}>
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{r.inputTicker}</span>
                            <span style={{ fontSize: 13, color: "var(--ink-faint)", fontStyle: "italic" }}>—</span>
                            <span /><span /><StatusBadge cfg={cfg} />
                          </div>
                        )}
                        {r.mappings.map((m, mi) => {
                          const sc = styleColor(m.msStyle)
                          return (
                            <div key={mi} style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr 1fr 110px", padding: mi === 0 ? "14px 16px" : "8px 16px 14px 16px", gap: 12, alignItems: "center", borderTop: mi > 0 ? "1px dashed var(--border)" : "none", background: mi > 0 ? "var(--surface-sunken)" : "transparent" }}>
                              <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600, color: "var(--ink-muted)", visibility: mi === 0 ? "visible" : "hidden" }}>{r.inputTicker}</span>
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--accent)", textShadow: "0 0 12px rgba(0,200,255,0.3)" }}>{m.ticker}</span>
                                  {m.weight !== undefined && <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 20, background: "var(--split-light)", color: "var(--split-color)", fontWeight: 700 }}>{Math.round(m.weight * 100)}%</span>}
                                </div>
                                <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 2 }}>{m.name.length > 40 ? m.name.slice(0,38) + "…" : m.name}</div>
                              </div>
                              <div><span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: sc.bg, color: sc.color, fontWeight: 600, border: `1px solid ${sc.color}22` }}>{m.msStyle}</span></div>
                              <div style={{ fontSize: 12, color: "var(--ink-muted)" }}><div>{m.assetClass}</div><div style={{ fontSize: 11, color: "var(--ink-faint)" }}>{m.region}</div></div>
                              <div style={{ visibility: mi === 0 ? "visible" : "hidden" }}><StatusBadge cfg={cfg} /></div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── IMPORT TAB ── */}
        {activeTab === "import" && (
          <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 32, alignItems: "start" }}>

            {/* Left panel */}
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

              {/* File upload */}
              <div className="fade-up" style={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>Upload Rebalancer Export</span>
                </div>
                <div style={{ padding: 14 }}>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    style={{ border: "1px dashed var(--border-strong)", borderRadius: 8, padding: "32px 20px", textAlign: "center", cursor: "pointer", transition: "all 0.15s", background: "var(--surface)" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLDivElement).style.background = "rgba(0,200,255,0.03)" }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLDivElement).style.background = "var(--surface)" }}
                  >
                    <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.4 }}>⬆</div>
                    <div style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 4 }}>Click to upload Excel file</div>
                    <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>.xlsx export from rebalancer</div>
                  </div>
                  <input ref={fileInputRef} type="file" accept=".xlsx" onChange={handleFileChange} style={{ display: "none" }} />

                  {importResult && (
                    <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(0,200,255,0.06)", borderRadius: 8, border: "1px solid rgba(0,200,255,0.15)" }}>
                      <div style={{ fontSize: 12, color: "var(--accent)", fontWeight: 700, marginBottom: 4 }}>
                        {importResult.modelName}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>
                        {processedAccounts?.length ?? 0} account{(processedAccounts?.length ?? 0) > 1 ? "s" : ""} · {processedAccounts?.reduce((s, a) => s + a.processed.filter(p => p.action !== "sell-loss").length, 0) ?? 0} mappings
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Gains budget */}
              <div className="fade-up-1" style={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>Gains Budget</span>
                </div>
                <div style={{ padding: 14 }}>
                  <div style={{ fontSize: 12, color: "var(--ink-faint)", marginBottom: 10 }}>
                    Optional. Max realized gains allowed when selling unassigned positions. Losses are always sold first.
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ position: "relative", flex: 1 }}>
                      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-faint)", fontSize: 14 }}>$</span>
                      <input
                        value={gainsBudget}
                        onChange={e => setGainsBudget(e.target.value.replace(/[^0-9.]/g, ""))}
                        placeholder="e.g. 10000"
                        style={{ width: "100%", padding: "10px 12px 10px 24px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", color: "var(--ink)", fontFamily: "var(--font-mono)", fontSize: 13, outline: "none" }}
                        onFocus={e => { e.target.style.borderColor = "var(--accent)" }}
                        onBlur={e => { e.target.style.borderColor = "var(--border)" }}
                      />
                    </div>
                    {importResult && (
                      <button onClick={handleReprocess} style={{ padding: "10px 14px", background: "var(--accent)", color: "#000", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                        Apply
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Import legend */}
              <div className="fade-up-2" style={{ padding: "16px 18px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent)", fontFamily: "var(--font-mono)", marginBottom: 12 }}>Legend</div>
                {[
                  { dot: "#00f0c0", label: "Mapped", desc: "— treated as equivalent, included in export" },
                  { dot: "#ff4488", label: "Sell — Loss", desc: "— unrealized loss, sell first" },
                  { dot: "#ffaa00", label: "Sell — Gain", desc: "— within gains budget, sell" },
                ].map(item => (
                  <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: item.dot, flexShrink: 0, boxShadow: `0 0 6px ${item.dot}` }} />
                    <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                      <strong style={{ color: "var(--ink)" }}>{item.label}</strong> {item.desc}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Import results */}
            <div className="fade-up-2">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, minHeight: 36 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--ink)" }}>
                    {processed ? `${processed.length} Positions` : "Results"}
                  </span>
                  {importResult && <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>→ {importResult.modelName}</span>}
                </div>
                {processed && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {importCounts && (
                      <div style={{ display: "flex", gap: 6 }}>
                        {importCounts.mapped    > 0 && <Chip label={`${importCounts.mapped} mapped`}     color="#00f0c0" bg="#001e18" glow="#00f0c0" />}
                        {importCounts.sellLoss  > 0 && <Chip label={`${importCounts.sellLoss} losses`}   color="#ff4488" bg="#1e0018" glow="#ff4488" />}
                        {importCounts.sellGain  > 0 && <Chip label={`${importCounts.sellGain} gains`}    color="#ffaa00" bg="#1e0800" glow="#ffaa00" />}
                      </div>
                    )}
                    <button onClick={() => processedAccounts && exportImportCSV(processedAccounts)}
                      style={{ padding: "3px 12px", background: "rgba(0,200,255,0.08)", color: "var(--accent)", border: "1px solid rgba(0,200,255,0.25)", borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-mono)" }}>
                      Export All
                    </button>
                  </div>
                )}
              </div>

              {!processed && !importLoading && (
                <EmptyState text="Upload a rebalancer Excel file to begin" />
              )}
              {importLoading && <Skeleton />}
              {importError && (
                <div style={{ padding: "14px 18px", background: "var(--red-light)", color: "var(--red)", borderRadius: 10, border: "1px solid #ff448833", fontSize: 13 }}>
                  ⚠ {importError}
                </div>
              )}

              {processed && !importLoading && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {/* Summary bar */}
                  {importCounts && (gainsBudget || importCounts.sellLoss > 0 || importCounts.sellGain > 0) && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 8 }}>
                      <SummaryCard label="Gains Realized" value={fmt$(importCounts.totalGain)} color="#ffaa00" />
                      <SummaryCard label="Losses Harvested" value={fmt$(Math.abs(importCounts.totalLoss))} color="#ff4488" />
                      <SummaryCard label="Budget Remaining" value={gainsBudget ? fmt$(Math.max(0, parseFloat(gainsBudget) - importCounts.totalGain)) : "—"} color="#00c8ff" />
                    </div>
                  )}

                  {/* Table header */}
                  <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 1fr 100px 110px", padding: "8px 16px", gap: 12, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
                    <span>Ticker</span><span>Security</span><span>Maps To / Action</span><span>Value / G&L</span><span>Decision</span>
                  </div>

                  {processed.map((p, idx) => {
                    const isMap = p.action === "map"
                    const isLoss = p.action === "sell-loss"
                    const isGain = p.action === "sell-gain"
                    const dotColor = isMap ? "#00f0c0" : isLoss ? "#ff4488" : "#ffaa00"
                    const badgeBg = isMap ? "#001e18" : isLoss ? "#1e0018" : "#1e0800"
                    const isSplit = isMap && p.matches.length > 1
                    const badgeLabel = isSplit ? "Split Map" : isMap ? "Mapped" : isLoss ? "Sell — Loss" : "Sell — Gain"

                    return (
                      <div key={p.holding.ticker + idx} className="fade-up"
                        style={{ animationDelay: `${idx * 0.02}s`, background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--border-strong)")}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}>
                        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 1fr 100px 110px", padding: "13px 16px", gap: 12, alignItems: "center" }}>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--ink-muted)" }}>{p.holding.ticker}</span>
                          <div>
                            <div style={{ fontSize: 13, color: "var(--ink)" }}>{p.holding.name.length > 32 ? p.holding.name.slice(0,30) + "…" : p.holding.name}</div>
                            <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 2 }}>{p.holding.msCategory}</div>
                          </div>
                          <div>
                            {isMap && p.matches.length > 0 ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--accent)", textShadow: "0 0 12px rgba(0,200,255,0.3)" }}>
                                    {p.matches.map(m => m.ticker).join(" / ")}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <span style={{ fontSize: 12, color: "var(--ink-faint)", fontStyle: "italic" }}>
                                {isLoss ? "Sell to realize loss" : `Sell — ${fmt$(p.gainConsumed || 0)} gain`}
                              </span>
                            )}
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 13, color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{fmt$(p.holding.currentValue)}</div>
                            <div style={{ fontSize: 11, marginTop: 2, color: p.holding.unrealizedGL < 0 ? "#ff4488" : p.holding.unrealizedGL > 0 ? "#00f0c0" : "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
                              {p.holding.unrealizedGL !== 0 ? fmt$(p.holding.unrealizedGL) : "—"}
                            </div>
                          </div>
                          <div>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, padding: "3px 9px", borderRadius: 20, background: badgeBg, color: dotColor, fontWeight: 600, whiteSpace: "nowrap", border: `1px solid ${dotColor}33`, boxShadow: `0 0 8px ${dotColor}22` }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, boxShadow: `0 0 4px ${dotColor}` }} />
                              {badgeLabel}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TRANSITION ANALYSIS TAB ── */}
        {activeTab === "transition" && (
          <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 32, alignItems: "start" }}>

            {/* Left panel */}
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

              {/* Client name */}
              <div className="fade-up" style={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>Client Name</span>
                </div>
                <div style={{ padding: 14 }}>
                  <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. Jennifer Miller"
                    style={{ width: "100%", padding: "10px 14px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", color: "var(--ink)", fontFamily: "var(--font-mono)", fontSize: 13, outline: "none" }}
                    onFocus={e => { e.target.style.borderColor = "var(--accent)" }}
                    onBlur={e => { e.target.style.borderColor = "var(--border)" }}
                  />
                </div>
              </div>

              {/* File upload */}
              <div className="fade-up-1" style={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>Upload Export</span>
                </div>
                <div style={{ padding: 14 }}>
                  <div
                    onClick={() => transitionFileRef.current?.click()}
                    onDragEnter={e => { e.preventDefault(); e.stopPropagation() }}
                    onDragOver={e => { e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLDivElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLDivElement).style.background = "rgba(0,200,255,0.06)" }}
                    onDragLeave={e => { e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLDivElement).style.background = "var(--surface)" }}
                    onDrop={e => { e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLDivElement).style.background = "var(--surface)"; const file = e.dataTransfer.files?.[0]; if (file) handleTransitionImport(file) }}
                    style={{ border: "1px dashed var(--border-strong)", borderRadius: 8, padding: "28px 20px", textAlign: "center", cursor: "pointer", transition: "all 0.15s", background: "var(--surface)" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLDivElement).style.background = "rgba(0,200,255,0.03)" }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLDivElement).style.background = "var(--surface)" }}
                  >
                    <div style={{ fontSize: 22, marginBottom: 6, opacity: 0.4 }}>⬆</div>
                    <div style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 4 }}>Drag & drop or click</div>
                    <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>.xlsx rebalancer export</div>
                  </div>
                  <input ref={transitionFileRef} type="file" accept=".xlsx" onChange={e => { const f = e.target.files?.[0]; if (f) handleTransitionImport(f) }} style={{ display: "none" }} />
                  {transition && (
                    <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(0,200,255,0.06)", borderRadius: 8, border: "1px solid rgba(0,200,255,0.15)", fontSize: 11, color: "var(--accent)" }}>
                      {transition.modelName} · {transition.accounts.length} account{transition.accounts.length > 1 ? "s" : ""}
                    </div>
                  )}
                </div>
              </div>

              {/* Gains budget */}
              <div className="fade-up-1" style={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>Gains Budget</span>
                </div>
                <div style={{ padding: 14 }}>
                  <div style={{ fontSize: 12, color: "var(--ink-faint)", marginBottom: 10 }}>Max realized gains. Losses offset budget automatically.</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ position: "relative", flex: 1 }}>
                      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-faint)", fontSize: 14 }}>$</span>
                      <input value={transitionBudget} onChange={e => setTransitionBudget(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 10000"
                        style={{ width: "100%", padding: "10px 12px 10px 24px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", color: "var(--ink)", fontFamily: "var(--font-mono)", fontSize: 13, outline: "none" }}
                        onFocus={e => { e.target.style.borderColor = "var(--accent)" }}
                        onBlur={e => { e.target.style.borderColor = "var(--border)" }}
                      />
                    </div>
                    {transitionFile && <button onClick={handleTransitionReprocess} style={{ padding: "10px 14px", background: "var(--accent)", color: "#000", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Apply</button>}
                  </div>
                </div>
              </div>

              {/* Tax summary */}
              {transition && (
                <div className="fade-up-2" style={{ padding: "16px 18px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent)", fontFamily: "var(--font-mono)", marginBottom: 14 }}>Tax Summary</div>
                  {[
                    { label: "Total Value", value: fmt$(transition.totalValue), color: "var(--ink)" },
                    { label: "LT Gains (20%)", value: fmt$(transition.ltGains), color: "#00f0c0" },
                    { label: "ST Gains (37%)", value: fmt$(transition.stGains), color: "#ffaa00" },
                    { label: "Losses Harvested", value: fmt$(Math.abs(transition.losses)), color: "#ff4488" },
                    { label: "Net Realized G/L", value: fmt$(transition.totalTradeGL), color: transition.totalTradeGL >= 0 ? "#00f0c0" : "#ff4488" },
                    { label: "Estimated Tax", value: fmt$(transition.estimatedTax), color: "#ff4488" },
                    { label: "Tax Impact", value: `${(transition.taxImpactPct * 100).toFixed(2)}%`, color: "var(--ink-muted)" },
                  ].map(row => (
                    <div key={row.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12 }}>
                      <span style={{ color: "var(--ink-faint)" }}>{row.label}</span>
                      <span style={{ color: row.color, fontFamily: "var(--font-mono)", fontWeight: 600 }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right panel — grouped editable trades */}
            <div className="fade-up-2">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, minHeight: 36 }}>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--ink)" }}>
                  {transition ? `${editedTrades.length} Trades` : "Transition Analysis"}
                </span>
                {transition && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <Chip label={`${editedTrades.filter(t => t.tradeType === "buy").length} buys`} color="#00f0c0" bg="#001e18" glow="#00f0c0" />
                    <Chip label={`${editedTrades.filter(t => t.tradeType === "sell").length} sells`} color="#ff4488" bg="#1e0018" glow="#ff4488" />
                    <button onClick={() => exportTransitionPDF(transition, editedTrades, clientName)}
                      style={{ padding: "3px 12px", background: "rgba(0,200,255,0.08)", color: "var(--accent)", border: "1px solid rgba(0,200,255,0.25)", borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-mono)" }}>
                      Export PDF
                    </button>
                  </div>
                )}
              </div>

              {!transition && !transitionLoading && <EmptyState text="Enter client name, set gains budget, then upload the rebalancer export" />}
              {transitionLoading && <Skeleton />}
              {transitionError && <div style={{ padding: "14px 18px", background: "var(--red-light)", color: "var(--red)", borderRadius: 10, border: "1px solid #ff448833", fontSize: 13 }}>⚠ {transitionError}</div>}

              {transition && !transitionLoading && (() => {
                // Group trades by asset class
                const assetClasses = Array.from(new Set(editedTrades.map(t => t.assetClass)))
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {assetClasses.map(ac => {
                      const classTrades = editedTrades.filter(t => t.assetClass === ac)
                      const isExpanded = expandedClasses.has(ac)
                      const classTradeAmt = classTrades.reduce((s, t) => s + t.tradeAmount, 0)
                      const classGL = classTrades.reduce((s, t) => s + t.realizedGL, 0)
                      const classTax = classTrades.reduce((s, t) => s + t.estimatedTax, 0)

                      return (
                        <div key={ac} style={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                          {/* Class header — clickable to expand */}
                          <div
                            onClick={() => toggleClass(ac)}
                            style={{ display: "grid", gridTemplateColumns: "1fr 100px 90px 90px 30px", padding: "12px 16px", gap: 10, alignItems: "center", cursor: "pointer", borderBottom: isExpanded ? "1px solid var(--border)" : "none" }}
                            onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,200,255,0.03)")}
                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                          >
                            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{ac}</span>
                            <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: classTradeAmt >= 0 ? "#00f0c0" : "#ff4488", textAlign: "right" }}>
                              {classTradeAmt >= 0 ? "+" : ""}{fmt$(classTradeAmt)}
                            </span>
                            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: classGL !== 0 ? (classGL > 0 ? "#00f0c0" : "#ff4488") : "var(--ink-faint)", textAlign: "right" }}>
                              {classGL !== 0 ? fmt$(classGL) : "—"}
                            </span>
                            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: classTax > 0 ? "#ffaa00" : "var(--ink-faint)", textAlign: "right" }}>
                              {classTax > 0 ? fmt$(classTax) : "—"}
                            </span>
                            <span style={{ fontSize: 14, color: "var(--ink-faint)", textAlign: "center" }}>{isExpanded ? "▼" : "▶"}</span>
                          </div>

                          {/* Class header row */}
                          {isExpanded && (
                            <div style={{ padding: "6px 16px", background: "var(--surface-sunken)", display: "grid", gridTemplateColumns: "30px 80px 1fr 1fr 100px 90px 90px", gap: 8, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
                              <span></span><span>Type</span><span>Sell</span><span>Buy / Target</span><span style={{ textAlign: "right" }}>Trade $</span><span style={{ textAlign: "right" }}>G/L</span><span style={{ textAlign: "right" }}>Est. Tax</span>
                            </div>
                          )}

                          {/* Individual trades */}
                          {isExpanded && classTrades.map((trade, idx) => {
                            const isBuy = trade.tradeType === "buy"
                            const dotColor = isBuy ? "#00f0c0" : "#ff4488"
                            return (
                              <div key={trade.id} style={{ display: "grid", gridTemplateColumns: "30px 80px 1fr 1fr 100px 90px 90px", padding: "10px 16px", gap: 8, alignItems: "center", borderTop: "1px solid var(--border)", background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}>
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, boxShadow: `0 0 4px ${dotColor}`, display: "inline-block" }} />

                                {/* Type badge */}
                                <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: isBuy ? "#001e18" : "#1e0018", color: dotColor, fontWeight: 700, border: `1px solid ${dotColor}33`, whiteSpace: "nowrap" }}>
                                  {isBuy ? "Buy" : trade.isKeep ? "Rebal" : "Sell"}
                                </span>

                                {/* Sell ticker */}
                                <div>
                                  {!isBuy && (
                                    <>
                                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "#ff4488" }}>{trade.ticker}</span>
                                      <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 1 }}>{trade.securityName.length > 32 ? trade.securityName.slice(0,30) + "…" : trade.securityName}</div>
                                    </>
                                  )}
                                </div>

                                {/* Buy ticker — editable */}
                                <div>
                                  {isBuy ? (
                                    <div>
                                      <input
                                        value={trade.ticker}
                                        onChange={e => updateTrade(trade.id, "ticker", e.target.value.toUpperCase())}
                                        style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "var(--accent)", background: "transparent", border: "none", borderBottom: "1px dashed rgba(0,200,255,0.4)", outline: "none", width: 80, textShadow: "0 0 10px rgba(0,200,255,0.3)" }}
                                      />
                                      <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 1 }}>{trade.securityName.length > 32 ? trade.securityName.slice(0,30) + "…" : trade.securityName}</div>
                                    </div>
                                  ) : (
                                    trade.mappedTicker && (
                                      <span style={{ fontSize: 10, color: "var(--ink-faint)", fontStyle: "italic" }}>
                                        → <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>{trade.mappedTicker}</span>
                                      </span>
                                    )
                                  )}
                                </div>

                                {/* Trade amount */}
                                <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11, color: isBuy ? "#00f0c0" : "#ff4488" }}>
                                  {isBuy ? "+" : ""}{fmt$(Math.abs(trade.tradeAmount))}
                                </div>

                                {/* G/L */}
                                <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 10, color: trade.realizedGL < 0 ? "#ff4488" : trade.realizedGL > 0 ? "#00f0c0" : "var(--ink-faint)" }}>
                                  {trade.realizedGL !== 0 ? fmt$(trade.realizedGL) : "—"}
                                </div>

                                {/* Est tax */}
                                <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 10, color: trade.estimatedTax > 0 ? "#ffaa00" : "var(--ink-faint)" }}>
                                  {trade.estimatedTax > 0 ? fmt$(trade.estimatedTax) : "—"}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          </div>
        )}
      </main>

      <footer style={{ borderTop: "1px solid var(--border)", padding: "16px 40px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
        <span>Securities Mapper · {usingBlob ? "Live Blob Data" : "Sample Data Mode"}</span>
        <span>Morningstar data updated monthly</span>
      </footer>
    </div>
  )
}

// ─── Shared sub-components ─────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "var(--surface-raised)", borderRadius: 14, padding: "48px 48px", width: 600, boxShadow: "0 0 60px rgba(0,200,255,0.15), 0 8px 40px rgba(0,0,0,0.6)", border: "1px solid var(--border-strong)" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 20, marginBottom: 8, color: "var(--accent)" }}>{title}</div>
        {children}
      </div>
    </div>
  )
}

function AccountIdInput({ value, onChange, onConfirm }: { value: string; onChange: (v: string) => void; onConfirm: () => void }) {
  return (
    <>
      <div style={{ fontSize: 13, color: "var(--ink-faint)", marginBottom: 24 }}>Enter the Account ID to include in the export file.</div>
      <label style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Account ID</label>
      <input autoFocus value={value} onChange={e => onChange(e.target.value)} onKeyDown={e => e.key === "Enter" && onConfirm()} placeholder="e.g. 12345678"
        style={{ display: "block", width: "100%", marginTop: 8, marginBottom: 28, padding: "12px 16px", border: "1px solid var(--border-strong)", borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 15, background: "var(--surface)", color: "var(--ink)", outline: "none" }}
        onFocus={e => { e.target.style.borderColor = "var(--accent)" }}
        onBlur={e => { e.target.style.borderColor = "var(--border-strong)" }}
      />
      <div style={{ display: "flex", gap: 12 }}>
        <button style={{ flex: 1, padding: "11px 0", background: "var(--surface-sunken)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--ink-muted)" }}>Cancel</button>
        <button onClick={onConfirm} disabled={!value.trim()} style={{ flex: 2, padding: "11px 0", background: value.trim() ? "var(--accent)" : "var(--surface-sunken)", color: value.trim() ? "#000" : "var(--ink-faint)", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: value.trim() ? "pointer" : "not-allowed" }}>Download CSV</button>
      </div>
    </>
  )
}

function ResultsHeader() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr 1fr 110px", padding: "8px 16px", gap: 12, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
      <span>Input</span><span>Mapped To</span><span>MS Category</span><span>Asset Class / Region</span><span>Status</span>
    </div>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ padding: "14px 16px", background: "var(--surface-raised)", border: `1px solid ${color}22`, borderRadius: 10, boxShadow: `0 0 12px ${color}11` }}>
      <div style={{ fontSize: 11, color: "var(--ink-faint)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: "var(--font-mono)" }}>{value}</div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: "80px 40px", textAlign: "center", color: "var(--ink-faint)" }}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 32, marginBottom: 12, opacity: 0.2 }}>⟳</div>
      <div style={{ fontSize: 14 }}>{text}</div>
    </div>
  )
}

function Skeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {[1,2,3,4,5].map(i => <div key={i} className="skeleton" style={{ height: 72, borderRadius: 10 }} />)}
    </div>
  )
}

function Chip({ label, color, bg, glow }: { label: string; color: string; bg: string; glow: string }) {
  return <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 20, background: bg, color, fontWeight: 700, border: `1px solid ${glow}33`, boxShadow: `0 0 8px ${glow}22` }}>{label}</span>
}

function StatusBadge({ cfg }: { cfg: typeof STATUS_CONFIG[keyof typeof STATUS_CONFIG] }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, padding: "3px 9px", borderRadius: 20, background: cfg.bg, color: cfg.color, fontWeight: 600, whiteSpace: "nowrap", border: `1px solid ${cfg.dot}33`, boxShadow: `0 0 8px ${cfg.dot}22` }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.dot, boxShadow: `0 0 4px ${cfg.dot}` }} />
      {cfg.label}
    </span>
  )
}
