"use client"
import { useState, useEffect, useCallback, useRef } from "react"
import { MODELS } from "@/lib/types"
import type { ModelId, MappedSecurity, MorningstarRow, ModelUniverseRow } from "@/lib/types"
import type { ImportResult, AccountData, ProcessedHolding } from "@/lib/importParser"

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
function exportImportCSV(processed: ProcessedHolding[], accountId: string) {
  const rows = [["Account ID", "Targeted", "Equivalent", "Equivalent Buy Priority", "Equivalent Sell Priority", "Delete"]]
  processed.filter(p => p.action === "map" && p.matches.length > 0).forEach(p => {
    p.matches.forEach(m => {
      rows.push([accountId, m.ticker, p.holding.ticker, "Do Not Buy", "Default", ""])
    })
  })
  downloadCSV(rows, `AccountEquivalent-${accountId || "export"}-${new Date().toISOString().slice(0,10)}.csv`)
}
function downloadCSV(rows: string[][], filename: string) {
  const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url; a.download = filename; a.click()
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
  const [processed, setProcessed] = useState<ProcessedHolding[] | null>(null)
  const [gainsBudget, setGainsBudget] = useState("")
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [showImportExportModal, setShowImportExportModal] = useState(false)
  const [importExportAccountId, setImportExportAccountId] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    setImportLoading(true); setImportError(null); setImportResult(null); setProcessed(null)
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
    if (!fileInputRef.current?.files?.[0]) return
    handleImport(fileInputRef.current.files[0])
  }, [handleImport])

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

      {/* Import Export Modal */}
      {showImportExportModal && (
        <Modal title="Export AccountEquivalent" onClose={() => setShowImportExportModal(false)}>
          <AccountIdInput value={importExportAccountId} onChange={setImportExportAccountId}
            onConfirm={() => { if (processed) { exportImportCSV(processed, importExportAccountId); setShowImportExportModal(false) } }}
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
            {(["manual", "import"] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                padding: "5px 16px", borderRadius: 6, border: "none", cursor: "pointer",
                background: activeTab === tab ? "var(--accent)" : "transparent",
                color: activeTab === tab ? "#000" : "var(--ink-faint)",
                fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono)",
                textTransform: "uppercase", letterSpacing: "0.06em", transition: "all 0.15s",
              }}>
                {tab === "manual" ? "Manual" : "Import"}
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
                        Account {importResult.accountNumber} · {importResult.inModel.length} model holdings · {importResult.unassigned.length} unassigned
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
                    <button onClick={() => { setImportExportAccountId(importResult?.accountNumber || ""); setShowImportExportModal(true) }}
                      style={{ padding: "3px 12px", background: "rgba(0,200,255,0.08)", color: "var(--accent)", border: "1px solid rgba(0,200,255,0.25)", borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-mono)" }}>
                      Export
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
