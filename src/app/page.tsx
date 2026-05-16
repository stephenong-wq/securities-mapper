"use client"
import { useState, useEffect, useCallback } from "react"
import { MODELS } from "@/lib/types"
import type { ModelId, MappedSecurity, MorningstarRow, ModelUniverseRow } from "@/lib/types"

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

function exportCSV(results: MappedSecurity[], accountId: string) {
  const rows = [["Account ID", "Targeted", "Equivalent", "Equivalent Buy Priority", "Equivalent Sell Priority", "Delete"]]
  results.forEach(r => {
    if (r.mappings.length === 0) return
    r.mappings.forEach(m => {
      rows.push([accountId, m.ticker, r.inputTicker, "Do Not Buy", "Default", ""])
    })
  })
  const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `AccountEquivalent-${accountId || "export"}-${new Date().toISOString().slice(0,10)}.csv`
  a.click()
}

export default function Home() {
  const [selectedModel, setSelectedModel] = useState<ModelId>("stp")
  const [tickerInput, setTickerInput] = useState("")
  const [results, setResults] = useState<MappedSecurity[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [dataLoading, setDataLoading] = useState(true)
  const [msData, setMsData] = useState<MorningstarRow[]>([])
  const [universeData, setUniverseData] = useState<ModelUniverseRow[]>([])
  const [usingBlob, setUsingBlob] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportAccountId, setExportAccountId] = useState("")

  useEffect(() => {
    fetch("/api/data")
      .then(r => r.json())
      .then(d => {
        setMsData(d.msData)
        setUniverseData(d.universeData)
        setUsingBlob(d.usingBlob)
        if (d.error) setDataError(d.error)
      })
      .catch(() => setDataError("Failed to load reference data"))
      .finally(() => setDataLoading(false))
  }, [])

  const handleMap = useCallback(async () => {
    const tickers = tickerInput.split(/[\n,]+/).map(t => t.trim().toUpperCase()).filter(Boolean)
    if (!tickers.length) return
    setLoading(true)
    setResults(null)
    try {
      const res = await fetch("/api/map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers, modelId: selectedModel, msData, universeData }),
      })
      const data = await res.json()
      setResults(data.results)
    } finally {
      setLoading(false)
    }
  }, [tickerInput, selectedModel, msData, universeData])

  const handleExportClick = () => { setExportAccountId(""); setShowExportModal(true) }
  const handleExportConfirm = () => { if (!results) return; exportCSV(results, exportAccountId); setShowExportModal(false) }

  const selectedModelInfo = MODELS.find(m => m.id === selectedModel)!
  const statusCounts = results ? {
    mapped: results.filter(r => r.status === "mapped").length,
    split:  results.filter(r => r.status === "split").length,
    warn:   results.filter(r => r.status === "not-in-model" || r.status === "no-match").length,
  } : null

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {/* Export Modal */}
      {showExportModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "var(--surface-raised)", borderRadius: 14, padding: "48px 48px", width: 600, boxShadow: "0 0 60px rgba(0,200,255,0.15), 0 8px 40px rgba(0,0,0,0.6)", border: "1px solid var(--border-strong)" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 20, marginBottom: 8, color: "var(--accent)" }}>Export AccountEquivalent</div>
            <div style={{ fontSize: 13, color: "var(--ink-faint)", marginBottom: 24 }}>Enter the Account ID to include in the export file.</div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Account ID</label>
            <input
              autoFocus
              value={exportAccountId}
              onChange={e => setExportAccountId(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleExportConfirm()}
              placeholder="e.g. 12345678"
              style={{ display: "block", width: "100%", marginTop: 8, marginBottom: 28, padding: "12px 16px", border: "1px solid var(--border-strong)", borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 15, background: "var(--surface)", color: "var(--ink)", outline: "none" }}
              onFocus={e => { e.target.style.borderColor = "var(--accent)" }}
              onBlur={e => { e.target.style.borderColor = "var(--border-strong)" }}
            />
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setShowExportModal(false)} style={{ flex: 1, padding: "11px 0", background: "var(--surface-sunken)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--ink-muted)" }}>Cancel</button>
              <button onClick={handleExportConfirm} disabled={!exportAccountId.trim()} style={{ flex: 2, padding: "11px 0", background: exportAccountId.trim() ? "var(--accent)" : "var(--surface-sunken)", color: exportAccountId.trim() ? "#000" : "var(--ink-faint)", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: exportAccountId.trim() ? "pointer" : "not-allowed" }}>Download CSV</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header style={{ borderBottom: "1px solid var(--border)", background: "rgba(8,15,24,0.95)", backdropFilter: "blur(12px)", padding: "0 40px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--accent)", letterSpacing: "-0.5px", textShadow: "0 0 20px rgba(0,200,255,0.4)" }}>Securities Mapper</span>
          <span style={{ fontSize: 11, color: "var(--ink-faint)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", textTransform: "uppercase" }}>v1.0</span>
        </div>
        <div>
          {dataLoading ? (
            <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>Loading data…</span>
          ) : (
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: usingBlob ? "var(--green)" : "var(--amber)", background: usingBlob ? "var(--green-light)" : "var(--amber-light)", padding: "3px 10px", borderRadius: 20, border: `1px solid ${usingBlob ? "rgba(0,240,192,0.2)" : "rgba(0,200,255,0.2)"}` }}>
              {usingBlob ? "● Live data" : "● Sample data"}
            </span>
          )}
        </div>
      </header>

      <main style={{ flex: 1, maxWidth: 1100, width: "100%", margin: "0 auto", padding: "40px 40px 80px" }}>
        {dataError && (
          <div style={{ marginBottom: 24, padding: "10px 16px", background: "var(--amber-light)", color: "var(--amber)", borderRadius: 8, fontSize: 13, border: "1px solid rgba(0,200,255,0.2)" }}>⚠ {dataError}</div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 32, alignItems: "start" }}>

          {/* Left panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Model selector */}
            <div className="fade-up" style={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>Select Model</span>
              </div>
              <div style={{ padding: 6 }}>
                {MODELS.map(m => (
                  <button key={m.id} onClick={() => { setSelectedModel(m.id); setResults(null) }}
                    style={{ width: "100%", textAlign: "left", padding: "11px 14px", borderRadius: 7, background: selectedModel === m.id ? "rgba(0,200,255,0.08)" : "transparent", border: selectedModel === m.id ? "1px solid rgba(0,200,255,0.25)" : "1px solid transparent", cursor: "pointer", transition: "all 0.15s", boxShadow: selectedModel === m.id ? "0 0 12px rgba(0,200,255,0.08)" : "none" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: selectedModel === m.id ? "var(--accent)" : "var(--ink)" }}>{m.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Input */}
            <div className="fade-up-1" style={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>Input Securities</span>
              </div>
              <div style={{ padding: 14 }}>
                <textarea
                  value={tickerInput}
                  onChange={e => setTickerInput(e.target.value)}
                  placeholder={"Paste tickers here...\nVTI\nIXUS\nAGG\nQQQ, SPY, BND"}
                  rows={10}
                  style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontFamily: "var(--font-mono)", fontSize: 13, background: "var(--surface)", color: "var(--ink)", resize: "vertical", outline: "none", lineHeight: 1.9 }}
                  onFocus={e => { e.target.style.borderColor = "var(--accent)"; e.target.style.boxShadow = "0 0 0 2px rgba(0,200,255,0.1)" }}
                  onBlur={e => { e.target.style.borderColor = "var(--border)"; e.target.style.boxShadow = "none" }}
                />
                <button
                  onClick={handleMap}
                  disabled={loading || dataLoading || !tickerInput.trim()}
                  style={{ marginTop: 10, width: "100%", padding: "12px 0", background: loading || dataLoading || !tickerInput.trim() ? "var(--surface-sunken)" : "var(--accent)", color: loading || dataLoading || !tickerInput.trim() ? "var(--ink-faint)" : "#000", border: "none", borderRadius: 8, fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 700, cursor: loading || !tickerInput.trim() ? "not-allowed" : "pointer", transition: "all 0.15s", boxShadow: !loading && !dataLoading && tickerInput.trim() ? "0 0 20px rgba(0,200,255,0.3)" : "none" }}
                >
                  {loading ? "Mapping…" : "Run Mapping →"}
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
                    {key === "mapped"        && " — equivalent found in model"}
                    {key === "split"         && " — maps to multiple tickers"}
                    {key === "not-in-model"  && " — not available in this model"}
                    {key === "no-match"      && " — ticker not in Morningstar data"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Right panel */}
          <div className="fade-up-2">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, minHeight: 36 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--ink)" }}>
                  {results ? `${results.length} Securities` : "Results"}
                </span>
                {selectedModelInfo && <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>→ {selectedModelInfo.label}</span>}
              </div>
              {results && (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {statusCounts && (
                    <div style={{ display: "flex", gap: 6 }}>
                      {statusCounts.mapped > 0 && <Chip label={`${statusCounts.mapped} mapped`} color="#00f0c0" bg="#001e18" glow="#00f0c0" />}
                      {statusCounts.split  > 0 && <Chip label={`${statusCounts.split} split`}   color="#4488ff" bg="#001030" glow="#4488ff" />}
                      {statusCounts.warn   > 0 && <Chip label={`${statusCounts.warn} issues`}   color="#ff4488" bg="#1e0018" glow="#ff4488" />}
                    </div>
                  )}
                  <button onClick={handleExportClick} style={{ padding: "3px 12px", background: "rgba(0,200,255,0.08)", color: "var(--accent)", border: "1px solid rgba(0,200,255,0.25)", borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-mono)" }}>
                    Export
                  </button>
                </div>
              )}
            </div>

            {!results && !loading && (
              <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: "80px 40px", textAlign: "center", color: "var(--ink-faint)" }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 32, marginBottom: 12, opacity: 0.2 }}>⟳</div>
                <div style={{ fontSize: 14 }}>Paste tickers and select a model to begin mapping</div>
              </div>
            )}

            {loading && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[1,2,3,4,5].map(i => <div key={i} className="skeleton" style={{ height: 72, borderRadius: 10 }} />)}
              </div>
            )}

            {results && !loading && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr 1fr 110px", padding: "8px 16px", gap: 12, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
                  <span>Input</span><span>Mapped To</span><span>MS Category</span><span>Asset Class / Region</span><span>Status</span>
                </div>
                {results.map((r, idx) => {
                  const cfg = STATUS_CONFIG[r.status]
                  return (
                    <div key={r.inputTicker + idx} className="fade-up"
                      style={{ animationDelay: `${idx * 0.03}s`, background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", transition: "border-color 0.15s" }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--border-strong)")}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}
                    >
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
                                {m.weight !== undefined && (
                                  <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 20, background: "var(--split-light)", color: "var(--split-color)", fontWeight: 700, border: "1px solid rgba(68,136,255,0.2)" }}>
                                    {Math.round(m.weight * 100)}%
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 2 }} title={m.name}>
                                {m.name.length > 40 ? m.name.slice(0,38) + "…" : m.name}
                              </div>
                            </div>
                            <div>
                              <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: sc.bg, color: sc.color, fontWeight: 600, border: `1px solid ${sc.color}22` }}>
                                {m.msStyle}
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                              <div>{m.assetClass}</div>
                              <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>{m.region}</div>
                            </div>
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
      </main>

      <footer style={{ borderTop: "1px solid var(--border)", padding: "16px 40px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
        <span>Securities Mapper · {usingBlob ? "Live Blob Data" : "Sample Data Mode"}</span>
        <span>Morningstar data updated monthly</span>
      </footer>
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
