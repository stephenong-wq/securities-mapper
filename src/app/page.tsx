"use client"
import { useState, useEffect, useCallback, useRef } from "react"
import { MODELS } from "@/lib/types"
import type { ModelId, MappedSecurity, MorningstarRow, ModelUniverseRow } from "@/lib/types"
import type { ImportResult, AccountData, ProcessedHolding } from "@/lib/importParser"
import type { TransitionSummary, TradeRow, AssetClassGroup, HoldingRow, EquivRow } from "@/lib/transitionEngine"

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
  if (n === 0) return "$0"
  const abs = Math.abs(n)
  const formatted = abs.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
  return n < 0 ? `-${formatted}` : formatted
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
function exportImportCSV(processedAccounts: { accountId: string; processed: ProcessedHolding[] }[], editedMappings: Record<string, string>) {
  const rows = [["Account ID", "Targeted", "Equivalent", "Equivalent Buy Priority", "Equivalent Sell Priority", "Delete"]]
  processedAccounts.forEach(({ accountId, processed }) => {
    processed.filter(p => (p.action === "map" || p.action === "sell-gain") && p.matches.length > 0).forEach(p => {
      // Use edited mapping if available, otherwise use original matches
      const editedValue = editedMappings[p.holding.ticker]
      if (editedValue) {
        // Split by " / " or "/" to support multiple targets
        const tickers = editedValue.split(/\s*\/\s*/).map(t => t.trim()).filter(Boolean)
        tickers.forEach(ticker => {
          rows.push([accountId, ticker, p.holding.ticker, "Do Not Buy", "Default", ""])
        })
      } else {
        p.matches.forEach(m => {
          rows.push([accountId, m.ticker, p.holding.ticker, "Do Not Buy", "Default", ""])
        })
      }
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

// ─── PDF Export ─────────────────────────────────────────────────────────────
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = document.createElement("script")
    s.src = src; s.onload = () => resolve(); s.onerror = reject
    document.head.appendChild(s)
  })
}

async function exportTransitionPDF(transition: TransitionSummary, trades: TradeRow[], clientName: string) {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { jsPDF } = (window as any).jspdf
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })

  const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
  const fmtD = (n: number) => n === 0 ? "$0.00" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })
  const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`
  const name = clientName || transition.clientName
  const sells = trades.filter(t => t.tradeType === "sell").sort((a, b) => a.tradeAmount - b.tradeAmount).slice(0, 10)
  const buys = trades.filter(t => t.tradeType === "buy").sort((a, b) => b.tradeAmount - a.tradeAmount).slice(0, 10)

  const W = 210; const M = 15; const lineH = 6
  let y = 20

  // Header
  doc.setFont("helvetica", "bold")
  doc.setFontSize(18)
  doc.setTextColor(44, 44, 44)
  doc.text("Portfolio Transition Analysis", M, y)
  doc.setFontSize(22)
  doc.setTextColor(61, 52, 39)
  doc.text("Savvy", W - M, y, { align: "right" })
  y += 8

  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text(`Client: ${name}`, M, y); y += 5
  doc.text(`Prepared by Savvy Advisors · ${transition.date}`, M, y); y += 5
  doc.text(`Target Model: ${transition.modelName}`, M, y); y += 8

  doc.setDrawColor(200, 184, 154)
  doc.setLineWidth(0.5)
  doc.line(M, y, W - M, y); y += 8

  // Metrics
  const metrics = [
    { label: "TOTAL VALUE", value: fmt(transition.totalValue), color: [44, 44, 44] as [number,number,number] },
    { label: "TRANSITION G/L", value: fmtD(transition.totalTradeGL), color: transition.totalTradeGL < 0 ? [192, 57, 43] as [number,number,number] : [44, 44, 44] as [number,number,number] },
    { label: "ESTIMATED TAX", value: fmtD(transition.estimatedTax), color: [192, 57, 43] as [number,number,number] },
    { label: "TAX IMPACT", value: `${(transition.taxImpactPct * 100).toFixed(2)}%`, color: [192, 57, 43] as [number,number,number] },
  ]
  const mW = (W - 2 * M - 9) / 4
  metrics.forEach((m, i) => {
    const x = M + i * (mW + 3)
    doc.setDrawColor(200)
    doc.setFillColor(255, 255, 255)
    doc.rect(x, y, mW, 18, "S")
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7)
    doc.setTextColor(150)
    doc.text(m.label, x + 3, y + 5)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(12)
    doc.setTextColor(...m.color)
    doc.text(m.value, x + 3, y + 13)
  })
  y += 26

  // Asset Allocation table
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(150)
  doc.text("ASSET ALLOCATION", M, y); y += 4
  doc.setDrawColor(200, 184, 154)
  doc.line(M, y, W - M, y); y += 5

  const acCols = [55, 30, 30, 35, 35]
  const acHeaders = ["Asset Class", "Current %", "Target %", "Post-Trade %", "Trade Amount"]
  doc.setFillColor(61, 52, 39)
  doc.rect(M, y, W - 2 * M, 6, "F")
  doc.setTextColor(255)
  doc.setFontSize(7)
  let cx = M + 2
  acHeaders.forEach((h, i) => {
    doc.text(h, cx, y + 4, { align: i > 0 ? "right" : "left" })
    cx += acCols[i]
  })
  y += 6

  transition.assetAllocation.forEach((row, ri) => {
    if (ri % 2 === 0) { doc.setFillColor(249, 247, 244); doc.rect(M, y, W - 2 * M, 5, "F") }
    doc.setTextColor(44, 44, 44)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    let cx2 = M + 2
    const vals = [row.assetClass, fmtPct(row.currentPct), fmtPct(row.targetPct), fmtPct(row.postTradePct), (row.tradeAmount >= 0 ? "+" : "") + fmt(row.tradeAmount)]
    vals.forEach((v, i) => {
      if (i > 0) doc.setTextColor(row.tradeAmount < 0 && i === 4 ? 192 : i === 3 ? 26 : 44, i === 3 ? 92 : i === 4 && row.tradeAmount < 0 ? 57 : 44, i === 3 ? 138 : 44)
      doc.text(v, cx2, y + 3.5, { align: i > 0 ? "right" : "left" })
      doc.setTextColor(44, 44, 44)
      cx2 += acCols[i]
    })
    y += 5
  })
  y += 8

  // Tax grid
  const taxBoxW = (W - 2 * M - 5) / 2
  const preTax = [
    ["Unrealized G/L", fmtD(transition.ltGains + transition.stGains + transition.losses)],
    ["Gains", fmtD(transition.ltGains + transition.stGains)],
    ["Losses", fmtD(transition.losses)],
  ]
  const postTax = [
    ["Long Term Gains", fmtD(transition.ltGains)],
    ["Short Term Gains", fmtD(transition.stGains)],
    ["Net Realized G/L", fmtD(transition.totalTradeGL)],
    ["Estimated Tax", fmtD(transition.estimatedTax)],
    ["# of Trades", String(transition.numTrades)],
  ]

  const drawTaxBox = (label: string, rows: string[][], bx: number) => {
    doc.setFillColor(61, 52, 39)
    doc.rect(bx, y, taxBoxW, 6, "F")
    doc.setTextColor(255)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(7)
    doc.text(label, bx + 3, y + 4)
    let ty = y + 8
    rows.forEach(([k, v]) => {
      doc.setFont("helvetica", "normal")
      doc.setFontSize(8)
      doc.setTextColor(44, 44, 44)
      doc.text(k, bx + 3, ty)
      doc.text(v, bx + taxBoxW - 3, ty, { align: "right" })
      doc.setDrawColor(240, 236, 230)
      doc.line(bx, ty + 1.5, bx + taxBoxW, ty + 1.5)
      ty += 5
    })
  }
  drawTaxBox("PRE-TRANSITION", preTax, M)
  drawTaxBox("POST-TRANSITION", postTax, M + taxBoxW + 5)
  y += 6 + postTax.length * 5 + 10

  // Footer
  doc.setFontSize(7)
  doc.setTextColor(180)
  doc.text("This analysis is for internal advisory use only. Tax estimates are approximate and do not constitute tax advice.", M, 287)

  // Page 2
  doc.addPage()
  y = 20

  doc.setFont("helvetica", "bold")
  doc.setFontSize(18)
  doc.setTextColor(44, 44, 44)
  doc.text("Detailed Trade Analysis", M, y)
  doc.setFontSize(22)
  doc.setTextColor(61, 52, 39)
  doc.text("Savvy", W - M, y, { align: "right" })
  y += 8
  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text(`Client: ${name}`, M, y); y += 5
  doc.text(`Prepared by Savvy Advisors · ${transition.date}`, M, y); y += 10

  // Accounts table
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(150)
  doc.text("ACCOUNTS", M, y); y += 4
  doc.line(M, y, W - M, y); y += 5
  doc.setFillColor(61, 52, 39)
  doc.rect(M, y, W - 2 * M, 6, "F")
  doc.setTextColor(255)
  doc.setFontSize(7)
  doc.text("Account", M + 2, y + 4)
  doc.text("Reg Type", M + 60, y + 4)
  doc.text("Account Value", W - M - 2, y + 4, { align: "right" })
  y += 6
  transition.accounts.forEach((a, ri) => {
    if (ri % 2 === 0) { doc.setFillColor(249, 247, 244); doc.rect(M, y, W - 2 * M, 5, "F") }
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(44, 44, 44)
    doc.text(a.accountNumber, M + 2, y + 3.5)
    doc.text(a.regType || "—", M + 60, y + 3.5)
    doc.text(fmt(a.value), W - M - 2, y + 3.5, { align: "right" })
    y += 5
  })
  y += 8

  // Top 10 Buys
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(150)
  doc.text("TOP 10 BUYS", M, y); y += 4
  doc.line(M, y, W - M, y); y += 5
  doc.setFillColor(61, 52, 39); doc.rect(M, y, W - 2 * M, 6, "F")
  doc.setTextColor(255); doc.setFontSize(7)
  doc.text("Account", M + 2, y + 4); doc.text("Ticker", M + 32, y + 4)
  doc.text("Security Name", M + 55, y + 4); doc.text("Trade $", W - M - 2, y + 4, { align: "right" })
  y += 6
  buys.forEach((t, ri) => {
    if (ri % 2 === 0) { doc.setFillColor(249, 247, 244); doc.rect(M, y, W - 2 * M, 5, "F") }
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(44, 44, 44)
    doc.text(t.accountNumber, M + 2, y + 3.5)
    doc.text(t.ticker, M + 32, y + 3.5)
    const sn = t.securityName.length > 35 ? t.securityName.slice(0, 33) + "…" : t.securityName
    doc.text(sn, M + 55, y + 3.5)
    doc.setTextColor(26, 122, 74)
    doc.text("+" + fmt(t.tradeAmount), W - M - 2, y + 3.5, { align: "right" })
    y += 5
  })
  y += 8

  // Top 10 Sells
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(150)
  doc.text("TOP 10 SELLS", M, y); y += 4
  doc.line(M, y, W - M, y); y += 5
  doc.setFillColor(61, 52, 39); doc.rect(M, y, W - 2 * M, 6, "F")
  doc.setTextColor(255); doc.setFontSize(7)
  doc.text("Account", M + 2, y + 4); doc.text("Ticker", M + 32, y + 4)
  doc.text("Security Name", M + 55, y + 4)
  doc.text("Trade $", W - M - 32, y + 4, { align: "right" })
  doc.text("G/L $", W - M - 2, y + 4, { align: "right" })
  y += 6
  sells.forEach((t, ri) => {
    if (ri % 2 === 0) { doc.setFillColor(249, 247, 244); doc.rect(M, y, W - 2 * M, 5, "F") }
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(44, 44, 44)
    doc.text(t.accountNumber, M + 2, y + 3.5)
    doc.text(t.ticker, M + 32, y + 3.5)
    const sn = t.securityName.length > 30 ? t.securityName.slice(0, 28) + "…" : t.securityName
    doc.text(sn, M + 55, y + 3.5)
    doc.setTextColor(192, 57, 43)
    doc.text(fmt(t.tradeAmount), W - M - 32, y + 3.5, { align: "right" })
    doc.setTextColor(t.realizedGL < 0 ? 192 : t.realizedGL > 0 ? 26 : 100, t.realizedGL < 0 ? 57 : t.realizedGL > 0 ? 122 : 100, t.realizedGL < 0 ? 43 : t.realizedGL > 0 ? 74 : 100)
    doc.text(t.realizedGL !== 0 ? fmtD(t.realizedGL) : "$0.00", W - M - 2, y + 3.5, { align: "right" })
    y += 5
  })

  doc.setFontSize(7); doc.setTextColor(180)
  doc.text("This analysis is for internal advisory use only. Tax estimates are approximate and do not constitute tax advice.", M, 287)

  const filename = `Transition-${(name || "Client").replace(/\s+/g, "-")}-${new Date().toISOString().slice(0,10)}.pdf`
  doc.save(filename)
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function Home() {
  const [activeTab, setActiveTab] = useState<"manual" | "import" | "transition">("import")

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
  const [editedMappings, setEditedMappings] = useState<Record<string, string>>({})

  // Transition tab state
  const [transition, setTransition] = useState<TransitionSummary | null>(null)
  const [transitionLoading, setTransitionLoading] = useState(false)
  const [transitionError, setTransitionError] = useState<string | null>(null)
  const [clientName, setClientName] = useState("")
  const [transitionBudget, setTransitionBudget] = useState("")
  const [editedTrades, setEditedTrades] = useState<TradeRow[]>([])
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set())
  const [expandedAssetClasses, setExpandedAssetClasses] = useState<Set<string>>(new Set())
  const transitionFileRef = useRef<HTMLInputElement>(null)
  const [transitionFile, setTransitionFile] = useState<File | null>(null)
  // User-editable mappings: { unassignedTicker: "VOO / SCHG" }
  const [userMappings, setUserMappings] = useState<Record<string, string>>({})
  const [showMappingsPanel, setShowMappingsPanel] = useState(false)

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
      setEditedMappings({})
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
      setEditedMappings({})
      if (data.processedAccounts?.length > 0) setSelectedAccountId(data.processedAccounts[0].accountId)
    } catch (e) {
      setImportError(String(e))
    } finally { setImportLoading(false) }
  }, [uploadedFile, gainsBudget])

  // ─── Transition handlers ──────────────────────────────────────────────────
  const handleTransitionImport = async (file: File) => {
    setTransitionFile(file)
    setTransitionLoading(true); setTransitionError(null); setTransition(null); setEditedTrades([])
    setUserMappings({})  // reset mappings on new file
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
      const classes = new Set<string>(data.transition.trades.map((t: TradeRow) => t.assetClass))
      setExpandedClasses(classes)
      setExpandedAssetClasses(new Set<string>(data.transition.assetGroups?.map((g: AssetClassGroup) => g.assetClass) || []))
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
      if (Object.keys(userMappings).length > 0) formData.append("userMappings", JSON.stringify(userMappings))
      const res = await fetch("/api/transition", { method: "POST", body: formData })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setTransition(data.transition)
      setEditedTrades(data.transition.trades)
      const classes = new Set<string>(data.transition.trades.map((t: TradeRow) => t.assetClass))
      setExpandedClasses(classes)
      setExpandedAssetClasses(new Set<string>(data.transition.assetGroups?.map((g: AssetClassGroup) => g.assetClass) || []))
    } catch (e) { setTransitionError(String(e)) }
    finally { setTransitionLoading(false) }
  }

  const updateTrade = (id: string, field: string, value: string | number | boolean) => {
    setEditedTrades(prev => prev.map(t => {
      if (t.id !== id) return t
      const updated = { ...t, [field]: value, userOverride: true }

      // When trade amount changes, recalculate G/L proportionally
      if (field === "editTradeAmount") {
        const newAmt = Number(value)
        // Auto-set tradeType based on sign
        updated.tradeType = newAmt < 0 ? "sell" : "buy"
        updated.isSell = newAmt < 0
        if (t.isSell && t.currentValue > 0) {
          const ratio = Math.abs(newAmt) / t.currentValue
          updated.realizedGLLT = (t.unrealizedGLLT || 0) * ratio
          updated.realizedGLST = (t.unrealizedGLST || 0) * ratio
          updated.realizedGL = updated.realizedGLLT + updated.realizedGLST
          updated.estimatedTax = updated.realizedGL > 0
            ? (updated.realizedGLLT > 0 ? updated.realizedGLLT * 0.238 : 0) + (updated.realizedGLST > 0 ? updated.realizedGLST * 0.408 : 0)
            : 0
        }
      }

      // Manual G/L override
      if (field === "realizedGL") {
        const gl = Number(value)
        updated.estimatedTax = gl > 0
          ? (updated.realizedGLLT > 0 ? updated.realizedGLLT * 0.238 : 0) + (updated.realizedGLST > 0 ? updated.realizedGLST * 0.408 : 0)
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
                    onDragEnter={e => { e.preventDefault(); e.stopPropagation() }}
                    onDragOver={e => { e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLDivElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLDivElement).style.background = "rgba(0,200,255,0.06)" }}
                    onDragLeave={e => { e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLDivElement).style.background = "var(--surface)" }}
                    onDrop={e => { e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLDivElement).style.background = "var(--surface)"; const file = e.dataTransfer.files?.[0]; if (file) handleImport(file) }}
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
                    <button onClick={() => processedAccounts && exportImportCSV(processedAccounts, editedMappings)}
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
                              <input
                                  value={editedMappings[p.holding.ticker] ?? p.matches.map(m => m.ticker).join(" / ")}
                                  onChange={e => setEditedMappings(prev => ({ ...prev, [p.holding.ticker]: e.target.value.toUpperCase() }))}
                                  placeholder="e.g. VOO / IEFA"
                                  style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--accent)", background: "transparent", border: "none", borderBottom: "1px dashed rgba(0,200,255,0.3)", outline: "none", width: "100%", textShadow: "0 0 10px rgba(0,200,255,0.2)" }}
                                />
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
                    { label: "LT Gains (23.8%)", value: fmt$(transition.ltGains), color: "#00f0c0" },
                    { label: "ST Gains (40.8%)", value: fmt$(transition.stGains), color: "#ffaa00" },
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

            {/* Right panel — asset class grouped view */}
            <div className="fade-up-2">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, minHeight: 36 }}>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--ink)" }}>
                  {transition ? transition.modelName : "Transition Analysis"}
                </span>
                {transition && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <Chip label={`${transition.numTrades} trades`} color="#00f0c0" bg="#001e18" glow="#00f0c0" />
                    <Chip label={`${fmt$(transition.totalRealizedGL || 0)} cap gains`} color="#ffaa00" bg="#1e0800" glow="#ffaa00" />
                    <button onClick={() => setShowMappingsPanel(p => !p)}
                      style={{ padding: "3px 12px", background: showMappingsPanel ? "var(--accent)" : "rgba(0,200,255,0.08)", color: showMappingsPanel ? "#000" : "var(--accent)", border: "1px solid rgba(0,200,255,0.25)", borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-mono)" }}>
                      Mappings
                    </button>
                    <button
                      onClick={() => {
                        const allClasses = new Set<string>((transition.assetGroups || []).map(g => g.assetClass))
                        if (expandedAssetClasses.size === allClasses.size) {
                          setExpandedAssetClasses(new Set())
                        } else {
                          setExpandedAssetClasses(allClasses)
                        }
                      }}
                      style={{ padding: "3px 12px", background: "rgba(0,200,255,0.08)", color: "var(--accent)", border: "1px solid rgba(0,200,255,0.25)", borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-mono)" }}>
                      {expandedAssetClasses.size > 0 ? "Collapse All" : "Expand All"}
                    </button>
                    <button onClick={() => exportTransitionPDF(transition, editedTrades, clientName)}
                      style={{ padding: "3px 12px", background: "rgba(0,200,255,0.08)", color: "var(--accent)", border: "1px solid rgba(0,200,255,0.25)", borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-mono)" }}>
                      Export PDF
                    </button>
                  </div>
                )}
              </div>

              {/* Mappings Panel */}
              {transition && showMappingsPanel && (() => {
                // Collect all unassigned holdings from transition trades (equiv rows)
                const equivTrades = editedTrades.filter(t => t.isEquivalent)
                // Only show gain/map positions (not losses) to keep view clean
                const sellsWithMap = editedTrades.filter(t => t.isSell && !t.isKeep && t.mappedTicker && t.unrealizedGL > 0)
                // Build list of all mappable positions
                const allUnassigned = new Map<string, { ticker: string; name: string; currentValue: number; mappedTo: string }>()
                equivTrades.forEach(t => {
                  allUnassigned.set(t.ticker, { ticker: t.ticker, name: t.securityName, currentValue: t.currentValue, mappedTo: t.mappedTicker })
                })
                sellsWithMap.forEach(t => {
                  if (!allUnassigned.has(t.ticker))
                    allUnassigned.set(t.ticker, { ticker: t.ticker, name: t.securityName, currentValue: t.currentValue, mappedTo: t.mappedTicker })
                })
                const rows = Array.from(allUnassigned.values())
                if (rows.length === 0) return null
                return (
                  <div style={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 10, marginBottom: 16, overflow: "hidden" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px 80px", padding: "8px 14px", gap: 8, background: "var(--surface-sunken)", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)", fontFamily: "var(--font-mono)", borderBottom: "1px solid var(--border)" }}>
                      <span>Unassigned Security</span><span>Mapped To (use " / " for multiple)</span><span style={{ textAlign: "right" }}>Current $</span><span></span>
                    </div>
                    {rows.map(row => {
                      const currentMapping = userMappings[row.ticker] ?? row.mappedTo
                      return (
                        <div key={row.ticker} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px 80px", padding: "10px 14px", gap: 8, alignItems: "center", borderBottom: "1px solid var(--border)" }}>
                          <div>
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "var(--ink)" }}>{row.ticker}</span>
                            <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 2 }}>{row.name.length > 36 ? row.name.slice(0,34)+"…" : row.name}</div>
                          </div>
                          <input
                            value={currentMapping}
                            onChange={e => setUserMappings(prev => ({ ...prev, [row.ticker]: e.target.value.toUpperCase() }))}
                            placeholder="e.g. VOO / SCHG"
                            style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)", background: "transparent", border: "none", borderBottom: "1px dashed rgba(0,200,255,0.4)", outline: "none", width: "100%", textShadow: "0 0 8px rgba(0,200,255,0.2)" }}
                          />
                          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-muted)" }}>{fmt$(row.currentValue)}</span>
                          <button
                            onClick={() => setUserMappings(prev => { const n = {...prev}; delete n[row.ticker]; return n })}
                            style={{ fontSize: 10, color: "var(--ink-faint)", background: "transparent", border: "none", cursor: "pointer", textAlign: "right" }}>
                            Reset
                          </button>
                        </div>
                      )
                    })}
                    <div style={{ padding: "10px 14px", display: "flex", justifyContent: "flex-end", gap: 8 }}>
                      <button onClick={() => setUserMappings({})}
                        style={{ padding: "6px 14px", background: "transparent", color: "var(--ink-faint)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>
                        Reset All
                      </button>
                      <button onClick={handleTransitionReprocess}
                        style={{ padding: "6px 16px", background: "var(--accent)", color: "#000", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                        ↻ Recalculate Trades
                      </button>
                    </div>
                  </div>
                )
              })()}

              {!transition && !transitionLoading && <EmptyState text="Enter client name, set gains budget, then upload the rebalancer export" />}
              {transitionLoading && <Skeleton />}
              {transitionError && <div style={{ padding: "14px 18px", background: "var(--red-light)", color: "var(--red)", borderRadius: 10, border: "1px solid #ff448833", fontSize: 13 }}>⚠ {transitionError}</div>}

              {transition && !transitionLoading && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* Column headers */}
                  <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 90px 80px 90px 90px 90px 60px 60px 60px", padding: "6px 14px", gap: 8, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)", fontFamily: "var(--font-mono)" }}>
                    <span></span>
                    <span>Class / Security</span>
                    <span style={{ textAlign: "right" }}>Trade $</span>
                    <span style={{ textAlign: "right" }}>G/L $</span>
                    <span style={{ textAlign: "right" }}>Current $</span>
                    <span style={{ textAlign: "right" }}>Target $</span>
                    <span style={{ textAlign: "right" }}>Post $</span>
                    <span style={{ textAlign: "right" }}>Cur %</span>
                    <span style={{ textAlign: "right" }}>Tgt %</span>
                    <span style={{ textAlign: "right" }}>Post %</span>
                  </div>

                  {(transition.assetGroups || []).filter(g => g.assetClass !== "Cash").map(group => {
                    const isExpanded = expandedAssetClasses.has(group.assetClass)
                    const tradeDiff = group.tradeAmount
                    const diffFromTarget = group.postTradeValue - group.targetValue

                    return (
                      <div key={group.assetClass} style={{ background: "var(--surface-raised)", border: `1px solid ${group.inTolerance ? "var(--border)" : "#ff448844"}`, borderRadius: 10, overflow: "hidden" }}>
                        {/* Asset class row */}
                        <div
                          onClick={() => setExpandedAssetClasses(prev => { const next = new Set(prev); if (next.has(group.assetClass)) next.delete(group.assetClass); else next.add(group.assetClass); return next })}
                          style={{ display: "grid", gridTemplateColumns: "24px 1fr 90px 80px 90px 90px 90px 60px 60px 60px", padding: "12px 14px", gap: 8, alignItems: "center", cursor: "pointer", background: group.inTolerance ? "transparent" : "rgba(255,68,136,0.04)" }}
                          onMouseEnter={e => (e.currentTarget.style.background = group.inTolerance ? "rgba(0,200,255,0.03)" : "rgba(255,68,136,0.06)")}
                          onMouseLeave={e => (e.currentTarget.style.background = group.inTolerance ? "transparent" : "rgba(255,68,136,0.04)")}
                        >
                          {/* Tolerance indicator */}
                          <span style={{ fontSize: 14, color: group.inTolerance ? "#00f0c0" : "#ff4488" }}>
                            {group.inTolerance ? "✓" : "✗"}
                          </span>

                          {/* Class name + expand arrow */}
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)" }}>{group.assetClass}</span>
                            <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>{isExpanded ? "▼" : "▶"}</span>
                          </div>

                          {/* Trade $ — sum from editedTrades for dynamic updates */}
                          {(() => {
                            const liveTradeAmt = editedTrades
                              .filter(t => t.assetClass === group.assetClass && !t.isEquivalent)
                              .reduce((s, t) => s + (t.editTradeAmount ?? t.tradeAmount), 0)
                            return <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: liveTradeAmt > 0 ? "#00f0c0" : liveTradeAmt < 0 ? "#ff4488" : "var(--ink-faint)" }}>
                              {liveTradeAmt !== 0 ? `${liveTradeAmt > 0 ? "+" : ""}${fmt$(liveTradeAmt)}` : "—"}
                            </span>
                          })()}

                          {/* G/L $ — live from editedTrades */}
                          {(() => {
                            const classGL = editedTrades.filter(t => t.assetClass === group.assetClass && (t.isSell || (t.isEquivalent && (t.editTradeAmount ?? 0) < 0))).reduce((s,t) => s + t.realizedGL, 0)
                            return <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11, color: classGL < 0 ? "#ff4488" : classGL > 0 ? "#00f0c0" : "var(--ink-faint)" }}>
                              {classGL !== 0 ? fmt$(classGL) : "—"}
                            </span>
                          })()}

                          {/* Current $ */}
                          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-muted)" }}>{fmt$(group.currentValue)}</span>

                          {/* Target $ */}
                          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-muted)" }}>{fmt$(group.targetValue)}</span>

                          {/* Post $ — live from editedTrades */}
                          {(() => {
                            const liveTrade = editedTrades.filter(t => t.assetClass === group.assetClass && !t.isEquivalent).reduce((s, t) => s + (t.editTradeAmount ?? t.tradeAmount), 0)
                            const livePost = group.currentValue + liveTrade
                            const livePostPct = group.totalValue > 0 ? livePost / group.totalValue : 0
                            const liveTol = Math.abs(livePostPct - group.targetPct) <= 0.05
                            return <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: liveTol ? "#00f0c0" : "#ff4488" }}>{fmt$(livePost)}</span>
                          })()}

                          {/* Current % */}
                          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-muted)" }}>{(group.currentPct * 100).toFixed(1)}%</span>

                          {/* Target % */}
                          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-muted)" }}>{(group.targetPct * 100).toFixed(1)}%</span>

                          {/* Post % — live */}
                          {(() => {
                            const liveTrade2 = editedTrades.filter(t => t.assetClass === group.assetClass && !t.isEquivalent).reduce((s, t) => s + (t.editTradeAmount ?? t.tradeAmount), 0)
                            const livePost2 = group.currentValue + liveTrade2
                            const livePostPct2 = group.totalValue > 0 ? livePost2 / group.totalValue : 0
                            const liveTol2 = Math.abs(livePostPct2 - group.targetPct) <= 0.05
                            return <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, color: liveTol2 ? "#00f0c0" : "#ff4488" }}>
                              {(livePostPct2 * 100).toFixed(1)}%
                            </span>
                          })()}
                        </div>

                        {/* Expanded holdings — grouped by security with equivalents nested */}
                        {isExpanded && (
                          <div style={{ borderTop: "1px solid var(--border)" }}>
                            {(group.holdings || []).map((holding, hIdx) => {
                              const isSell = holding.tradeAmount < 0
                              const isBuy = holding.tradeAmount > 0
                              const hasEquivs = holding.equivalents && holding.equivalents.length > 0
                              const dotColor = isSell ? "#ff4488" : isBuy ? "#00f0c0" : "var(--ink-faint)"
                              const editTrade = editedTrades.find(t => t.ticker === holding.ticker && t.assetClass === group.assetClass && !t.isEquivalent)
                              const effectiveTradeAmt = editTrade ? (editTrade.editTradeAmount ?? editTrade.tradeAmount) : holding.tradeAmount
                              const effectiveGL = editTrade?.realizedGL || holding.realizedGL
                              const postVal = holding.effectiveCurrent + effectiveTradeAmt

                              return (
                                <div key={holding.ticker + hIdx}>
                                  <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 90px 80px 90px 90px 90px 60px 60px 60px", padding: "10px 14px", gap: 8, alignItems: "center", borderBottom: hasEquivs ? "none" : "1px solid var(--border)", background: hIdx % 2 === 0 ? "var(--surface-sunken)" : "transparent" }}>
                                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, boxShadow: `0 0 4px ${dotColor}`, display: "inline-block", margin: "0 auto" }} />
                                    <div>
                                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: isSell ? "#ff4488" : isBuy ? "var(--accent)" : "var(--ink)" }}>
                                          {editTrade && isBuy ? (
                                            <input value={editTrade.ticker} onChange={e => updateTrade(editTrade.id, "ticker", e.target.value.toUpperCase())}
                                              style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "var(--accent)", background: "transparent", border: "none", borderBottom: "1px dashed rgba(0,200,255,0.4)", outline: "none", width: 70 }} />
                                          ) : holding.ticker}
                                        </span>
                                        {editTrade && (
                                          <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: isSell ? "#1e0018" : "#001e18", color: dotColor, fontWeight: 700, border: `1px solid ${dotColor}33` }}>
                                            {isSell ? "Sell" : "Buy"}
                                          </span>
                                        )}
                                        {editTrade?.isKeep && <span style={{ fontSize: 10, color: "var(--ink-faint)" }}>rebal</span>}
                                        {hasEquivs && <span style={{ fontSize: 10, color: "#4488ff", opacity: 0.8 }}>+{holding.equivalents.length} equiv</span>}
                                      </div>
                                      <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 2 }}>{holding.securityName.length > 36 ? holding.securityName.slice(0,34) + "…" : holding.securityName}</div>
                                    </div>
                                    <div style={{ textAlign: "right" }}>
                                      <input
                                        type="text"
                                        defaultValue={effectiveTradeAmt !== 0 ? effectiveTradeAmt.toFixed(0) : ""}
                                        placeholder="0"
                                        key={editTrade?.id || holding.ticker}
                                        onBlur={e => {
                                          const raw = e.target.value.trim()
                                          if (raw === "" || raw === "-") { e.target.value = ""; return }
                                          const val = parseFloat(raw.replace(/[^0-9.-]/g, "")) || 0
                                          if (editTrade) {
                                            updateTrade(editTrade.id, "editTradeAmount", val)
                                          } else if (val !== 0) {
                                            setEditedTrades(prev => [...prev, {
                                              id: `manual-${holding.ticker}-${group.assetClass}`,
                                              accountId: "", accountNumber: "",
                                              ticker: holding.ticker, securityName: holding.securityName,
                                              tradeType: val < 0 ? "sell" as const : "buy" as const,
                                              tradeAmount: val, editTradeAmount: val,
                                              currentValue: holding.currentValue, targetValue: holding.targetValue,
                                              unrealizedGL: holding.unrealizedGL,
                                              unrealizedGLST: (holding as any).unrealizedGLST || 0,
                                              unrealizedGLLT: (holding as any).unrealizedGLLT || 0,
                                              isLongTerm: true, realizedGL: 0, realizedGLST: 0, realizedGLLT: 0, estimatedTax: 0,
                                              msCategory: "", productClass: "", assetClass: group.assetClass,
                                              mappedTicker: holding.ticker, mappedName: holding.securityName,
                                              isSell: val < 0, isKeep: true, isEquivalent: false, mapScore: 10, userOverride: true,
                                            }])
                                          }
                                          // Format display
                                          if (val !== 0) e.target.value = val.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
                                        }}
                                        onFocus={e => {
                                          // Show raw number on focus
                                          const raw = e.target.value.replace(/[^0-9.-]/g, "")
                                          e.target.value = raw
                                        }}
                                        style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, color: effectiveTradeAmt < 0 ? "#ff4488" : effectiveTradeAmt > 0 ? "#00f0c0" : "var(--ink-faint)", background: "transparent", border: "none", borderBottom: `1px dashed ${editTrade ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.08)"}`, outline: "none", width: 90, textAlign: "right" }} />
                                    </div>
                                    <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11, color: effectiveGL < 0 ? "#ff4488" : effectiveGL > 0 ? "#00f0c0" : "var(--ink-faint)" }}>{effectiveGL !== 0 ? fmt$(effectiveGL) : "—"}</span>
                                    <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-muted)" }}>{fmt$(holding.effectiveCurrent)}</span>
                                    <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-muted)" }}>{holding.targetValue > 0 ? fmt$(holding.targetValue) : "—"}</span>
                                    <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-muted)" }}>{fmt$(postVal)}</span>
                                    <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-faint)" }}>{group.totalValue > 0 ? ((holding.effectiveCurrent / group.totalValue) * 100).toFixed(1) + "%" : "—"}</span>
                                    <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-faint)" }}>{group.totalValue > 0 && holding.targetValue > 0 ? ((holding.targetValue / group.totalValue) * 100).toFixed(1) + "%" : "—"}</span>
                                    <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-faint)" }}>{group.totalValue > 0 ? ((postVal / group.totalValue) * 100).toFixed(1) + "%" : "—"}</span>
                                  </div>
                                  {hasEquivs && holding.equivalents.map((eq, eIdx) => {
                                    const equivTradeId = `equiv-${eq.ticker}-${holding.ticker}`
                                    const equivOverride = editedTrades.find(t => t.id === equivTradeId)
                                    const equivTradeAmt = equivOverride?.editTradeAmount ?? 0
                                    const equivPost = eq.currentValue + equivTradeAmt
                                    return (
                                      <div key={eq.ticker + eIdx} style={{ display: "grid", gridTemplateColumns: "24px 1fr 90px 80px 90px 90px 90px 60px 60px 60px", padding: "7px 14px 7px 36px", gap: 8, alignItems: "center", borderBottom: eIdx === holding.equivalents.length - 1 ? "1px solid var(--border)" : "none", background: "rgba(68,136,255,0.04)" }}>
                                        <span style={{ fontSize: 11, color: "#4488ff", textAlign: "center" }}>≈</span>
                                        <div>
                                          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, color: "#4488ff" }}>{eq.ticker}</span>
                                            <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 20, background: "#001030", color: "#4488ff", fontWeight: 700, border: "1px solid #4488ff33" }}>Equiv</span>
                                          </div>
                                          <div style={{ fontSize: 9, color: "var(--ink-faint)", marginTop: 1 }}>{eq.securityName.length > 40 ? eq.securityName.slice(0,38) + "…" : eq.securityName}</div>
                                        </div>
                                        {/* Editable trade for equiv — negative = sell */}
                                        <div style={{ textAlign: "right" }}>
                                          <input
                                            value={equivTradeAmt === 0 ? "" : equivTradeAmt.toFixed(0)}
                                            placeholder="0"
                                            onChange={e => {
                                              const raw = e.target.value
                                              if (raw === "-" || raw === "") {
                                                // Allow partial input - just store as string temporarily via display
                                                setEditedTrades(prev => {
                                                  const existing = prev.find(t => t.id === equivTradeId)
                                                  if (existing) return prev.map(t => t.id === equivTradeId ? { ...t, editTradeAmount: 0, tradeType: "sell" as const } : t)
                                                  return prev
                                                })
                                                return
                                              }
                                              const val = parseFloat(raw) || 0
                                              // Add/update an override trade row for this equiv
                                              setEditedTrades(prev => {
                                                const existing = prev.find(t => t.id === equivTradeId)
                                                if (existing) return prev.map(t => t.id === equivTradeId ? { ...t, editTradeAmount: val, tradeType: val < 0 ? "sell" as const : "buy" as const } : t)
                                                return [...prev, {
                                                  id: equivTradeId, accountId: "", accountNumber: "", ticker: eq.ticker, securityName: eq.securityName,
                                                  tradeType: val < 0 ? "sell" as const : "buy" as const, tradeAmount: val, editTradeAmount: val,
                                                  currentValue: eq.currentValue, targetValue: 0,
                                                  unrealizedGL: eq.unrealizedGL, unrealizedGLST: 0, unrealizedGLLT: 0, isLongTerm: true,
                                                  realizedGL: val < 0 ? eq.unrealizedGL * Math.abs(val) / eq.currentValue : 0,
                                                  realizedGLST: 0, realizedGLLT: 0, estimatedTax: 0,
                                                  msCategory: "", productClass: "", assetClass: group.assetClass,
                                                  mappedTicker: holding.ticker, mappedName: holding.securityName,
                                                  isSell: val < 0, isKeep: false, isEquivalent: true, mapScore: 0, userOverride: true,
                                                }]
                                              })
                                            }}
                                            style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: equivTradeAmt < 0 ? "#ff4488" : equivTradeAmt > 0 ? "#00f0c0" : "var(--ink-faint)", background: "transparent", border: "none", borderBottom: "1px dashed rgba(68,136,255,0.3)", outline: "none", width: 80, textAlign: "right", cursor: "text", pointerEvents: "all" }}
                                          />
                                        </div>
                                        <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-faint)" }}>—</span>
                                        <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11, color: "#4488ff" }}>{fmt$(eq.currentValue)}</span>
                                        <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-faint)" }}>—</span>
                                        <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11, color: "#4488ff" }}>{fmt$(equivPost)}</span>
                                        <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 10, color: "#4488ff" }}>{group.totalValue > 0 ? ((eq.currentValue / group.totalValue) * 100).toFixed(1) + "%" : "—"}</span>
                                        <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-faint)" }}>—</span>
                                        <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 10, color: "#4488ff" }}>{group.totalValue > 0 ? ((equivPost / group.totalValue) * 100).toFixed(1) + "%" : "—"}</span>
                                      </div>
                                    )
                                  })}
                                </div>
                              )
                            })}
                          </div>
                        )}                      </div>
                    )
                  })}


                  {/* Cash row — live from editedTrades */}
                  {(() => {
                    const currentCash = transition.currentCash || 0
                    const cashTarget = (transition.assetGroups || []).find(g => g.assetClass === "Cash")?.targetValue || 0
                    // Live net cash from edited trades
                    const liveSells = editedTrades.filter(t => t.tradeType === "sell").reduce((s, t) => s + Math.abs(t.editTradeAmount ?? t.tradeAmount), 0)
                    const liveBuys = editedTrades.filter(t => t.tradeType === "buy").reduce((s, t) => s + Math.abs(t.editTradeAmount ?? t.tradeAmount), 0)
                    const netCash = liveSells - liveBuys
                    const postCash = Math.max(0, currentCash + netCash)
                    const cashPct = transition.totalValue > 0 ? currentCash / transition.totalValue : 0
                    const cashTgtPct = transition.totalValue > 0 ? cashTarget / transition.totalValue : 0
                    const postCashPct = transition.totalValue > 0 ? postCash / transition.totalValue : 0
                    const inTol = postCash >= 0 && (cashTgtPct > 0 ? Math.abs(postCashPct - cashTgtPct) <= cashTgtPct * 0.25 : true)
                    if (currentCash <= 0 && netCash === 0) return null
                    return (
                      <div style={{ background: "var(--surface-raised)", border: `1px solid ${inTol ? "var(--border)" : "#ff448844"}`, borderRadius: 10, overflow: "hidden" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 90px 80px 90px 90px 90px 60px 60px 60px", padding: "12px 14px", gap: 8, alignItems: "center" }}>
                          <span style={{ fontSize: 14, color: inTol ? "#00f0c0" : "#ff4488" }}>{inTol ? "✓" : "✗"}</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>Cash</span>
                          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: netCash >= 0 ? "#00f0c0" : "#ff4488" }}>
                            {netCash !== 0 ? `${netCash > 0 ? "+" : ""}${fmt$(netCash)}` : "—"}
                          </span>
                          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-faint)" }}>—</span>
                          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-muted)" }}>{fmt$(currentCash)}</span>
                          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-muted)" }}>{cashTarget > 0 ? fmt$(cashTarget) : "—"}</span>
                          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: inTol ? "#00f0c0" : "#ff4488" }}>{fmt$(postCash)}</span>
                          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-faint)" }}>{(cashPct * 100).toFixed(1)}%</span>
                          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-faint)" }}>{cashTarget > 0 ? (cashTgtPct * 100).toFixed(1) + "%" : "—"}</span>
                          <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, color: inTol ? "#00f0c0" : "#ff4488" }}>{(postCashPct * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                    )
                  })()}                </div>
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
