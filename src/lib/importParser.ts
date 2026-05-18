import * as XLSX from "xlsx"

export interface ImportHolding {
  ticker: string
  name: string
  secSet: string
  msCategory: string
  productClass: string
  currentValue: number
  currentShares: number
  targetValue: number
  targetPct: number
  unrealizedGL: number
  unrealizedGLPct: number
  price: number
}

export interface ImportMatch {
  ticker: string
  name: string
  msCategory: string
  targetValue: number
  currentValue: number
  underweightValue: number
  score: number
  weight?: number  // for split maps, 0-1
}

export interface ImportResult {
  accountNumber: string
  modelName: string
  inModel: ImportHolding[]
  unassigned: ImportHolding[]
}

export interface ProcessedHolding {
  holding: ImportHolding
  action: "sell-loss" | "sell-gain" | "map"
  matches: ImportMatch[]  // 1 for single, 2+ for split
  gainConsumed?: number
}

// ─── Index fingerprinting (same logic as mapper.ts) ───────────────────────────
function indexFingerprint(name: string): string[] {
  const n = name.toLowerCase()
    .replace(/ishares|vanguard|schwab|spdr|invesco|fidelity|dimensional|avantis|jpmorgan|wisdomtree|first trust|blackrock|pimco|state street|columbia|pacer|global x|franklin|nuveen|abrdn|goldman sachs/gi, "")
    .replace(/etf|fund|trust|index|portfolio|series/gi, "")
    .trim()

  const signals: string[] = []
  if (/s&p\s*500|sp500/.test(n))            signals.push("sp500")
  if (/s&p\s*100/.test(n))                   signals.push("sp100")
  if (/total\s*(stock|market|us)/.test(n))   signals.push("total-us")
  if (/russell\s*2000|r2000/.test(n))        signals.push("russell2000")
  if (/russell\s*1000/.test(n))              signals.push("russell1000")
  if (/nasdaq|qqq/.test(n))                  signals.push("nasdaq100")
  if (/value/.test(n))                       signals.push("value")
  if (/growth/.test(n))                      signals.push("growth")
  if (/equal\s*weight/.test(n))              signals.push("equal-weight")
  if (/min(imum)?\s*vol|low\s*vol/.test(n))  signals.push("min-vol")
  if (/momentum/.test(n))                    signals.push("momentum")
  if (/quality/.test(n))                     signals.push("quality")
  if (/small[\s-]cap|small\s*co/.test(n))   signals.push("small-cap")
  if (/mid[\s-]cap/.test(n))                signals.push("mid-cap")
  if (/large[\s-]cap/.test(n))              signals.push("large-cap")
  if (/eafe/.test(n))                        signals.push("eafe")
  if (/ftse\s*dev/.test(n))                 signals.push("ftse-developed")
  if (/ftse\s*em|emerging/.test(n))          signals.push("emerging")
  if (/ex[\s-]china/.test(n))               signals.push("ex-china")
  if (/international|intl/.test(n))          signals.push("international")
  if (/aggregate|agg/.test(n))              signals.push("aggregate")
  if (/treasury|govt|government/.test(n))   signals.push("treasury")
  if (/tips|inflation[\s-]protect/.test(n)) signals.push("tips")
  if (/high\s*yield|hy/.test(n))            signals.push("high-yield")
  if (/muni|municipal/.test(n))             signals.push("muni")
  if (/mortgage|mbs/.test(n))               signals.push("mbs")
  if (/short[\s-]term|1[\s-]3|0[\s-]3/.test(n)) signals.push("short-term")
  if (/long[\s-]term|20\+|10[\s-]20/.test(n))   signals.push("long-term")
  if (/intermediate/.test(n))               signals.push("intermediate")
  if (/convertible/.test(n))                signals.push("convertible")
  if (/gold/.test(n))                       signals.push("commodity-gold")
  if (/commodity|commodit/.test(n))         signals.push("commodity-broad")
  if (/real\s*estate|reit/.test(n))         signals.push("real-estate")
  if (/dividend/.test(n))                   signals.push("dividend")
  if (/cyber|security/.test(n))             signals.push("cyber")
  if (/defense|aerospace/.test(n))          signals.push("defense")
  if (/technology|tech/.test(n))            signals.push("tech")
  return signals
}

function fingerprintOverlap(a: string[], b: string[]): number {
  const setA = new Set(a)
  return b.filter(x => setA.has(x)).length
}

// ─── Broad asset class grouping ───────────────────────────────────────────────
function broadClass(category: string, productClass: string): string {
  const cat = (category + " " + productClass).toLowerCase()
  if (cat.includes("emerging")) return "emerging"
  if (cat.includes("international") || cat.includes("foreign") || cat.includes("eafe") || cat.includes("europe") || cat.includes("global equity")) return "intl-developed"
  if (cat.includes("bond") || cat.includes("fixed") || cat.includes("muni") || cat.includes("treasury") || cat.includes("securitized")) return "fixed-income"
  if (cat.includes("real estate") || cat.includes("reit")) return "real-estate"
  if (cat.includes("commodity") || cat.includes("gold")) return "commodity"
  if (cat.includes("small")) return "us-small"
  if (cat.includes("mid")) return "us-mid"
  return "us-equity"
}

// ─── Score a model holding as a match for an unassigned holding ───────────────
function scoreCandidate(
  holding: ImportHolding,
  candidate: ImportHolding,
  maxUnderweight: number
): number {
  let score = 0

  // 1. Name fingerprint overlap (0-10 pts)
  const hFp = indexFingerprint(holding.name)
  const cFp = indexFingerprint(candidate.name)
  score += fingerprintOverlap(hFp, cFp) * 2

  // 2. Exact category match (5 pts)
  if (holding.msCategory.toLowerCase() === candidate.msCategory.toLowerCase()) score += 5

  // 3. Broad class match (3 pts)
  if (broadClass(holding.msCategory, holding.productClass) === broadClass(candidate.msCategory, candidate.productClass)) score += 3

  // 4. Allocation need — how underweight is the model holding (0-4 pts)
  const underweight = Math.max(0, candidate.targetValue - candidate.currentValue)
  if (maxUnderweight > 0) score += (underweight / maxUnderweight) * 4

  return score
}

// ─── Find best matches for an unassigned holding ──────────────────────────────
function findMatches(holding: ImportHolding, inModel: ImportHolding[]): ImportMatch[] {
  if (!inModel.length) return []

  const maxUnderweight = Math.max(...inModel.map(m => Math.max(0, m.targetValue - m.currentValue)))
  const holdingBroadClass = broadClass(holding.msCategory, holding.productClass)

  // Score all candidates
  const scored = inModel.map(candidate => ({
    candidate,
    score: scoreCandidate(holding, candidate, maxUnderweight),
    underweightValue: Math.max(0, candidate.targetValue - candidate.currentValue),
    broadClass: broadClass(candidate.msCategory, candidate.productClass),
  })).sort((a, b) => b.score - a.score)

  const top = scored[0]
  if (!top || top.score === 0) return []

  // Check if second candidate is a strong match AND covers different exposure
  const second = scored[1]
  const shouldSplit =
    second &&
    second.score >= top.score * 0.7 &&      // within 70% of top score
    second.broadClass !== top.broadClass &&   // different asset class
    holdingBroadClass !== top.broadClass      // holding spans multiple classes

  const toMatch = shouldSplit ? [top, second] : [top]

  // Calculate weights for split (proportional to allocation need)
  const totalUnderweight = toMatch.reduce((s, m) => s + m.underweightValue, 0)

  return toMatch.map(m => ({
    ticker: m.candidate.ticker,
    name: m.candidate.name,
    msCategory: m.candidate.msCategory,
    targetValue: m.candidate.targetValue,
    currentValue: m.candidate.currentValue,
    underweightValue: m.underweightValue,
    score: m.score,
    weight: toMatch.length > 1
      ? (totalUnderweight > 0 ? m.underweightValue / totalUnderweight : 1 / toMatch.length)
      : undefined,
  }))
}

// ─── Infer model name ─────────────────────────────────────────────────────────
function inferModelName(secSets: string[]): string {
  const unique = Array.from(new Set(secSets.filter(s => s && s !== "Unassigned" && s !== "Cash")))
  if (!unique.length) return "Unknown Model"
  const prefixes = unique.map(s => s.split(" - ")[0].trim())
  const uniquePrefixes = Array.from(new Set(prefixes))
  return uniquePrefixes.length === 1 ? uniquePrefixes[0] : uniquePrefixes.join(" / ")
}

// ─── Parse Excel ──────────────────────────────────────────────────────────────
export function parseImportExcel(buffer: ArrayBuffer): ImportResult {
  const wb = XLSX.read(buffer, { type: "array" })

  const holdingSheet = wb.Sheets["Holding and Trade Details"]
  if (!holdingSheet) throw new Error("Could not find 'Holding and Trade Details' sheet")

  const holdingRows = XLSX.utils.sheet_to_json<Record<string, string | number>>(holdingSheet, { defval: "" })

  // Target values from Asset Classification sheet
  const assetSheet = wb.Sheets["Asset Classification"]
  const targetMap = new Map<string, { targetValue: number; targetPct: number }>()
  if (assetSheet) {
    const assetRows = XLSX.utils.sheet_to_json<Record<string, string | number>>(assetSheet, { defval: "" })
    assetRows.forEach(row => {
      const ticker = String(row["Security"] || "").trim().toUpperCase()
      if (ticker) targetMap.set(ticker, {
        targetValue: parseFloat(String(row["Target $"] || "0")) || 0,
        targetPct: parseFloat(String(row["Target %"] || "0")) || 0,
      })
    })
  }

  // Account number
  const cashSheet = wb.Sheets["Account and Cash Details"]
  let accountNumber = ""
  if (cashSheet) {
    const cashRows = XLSX.utils.sheet_to_json<Record<string, string | number>>(cashSheet, { defval: "" })
    if (cashRows.length > 0) accountNumber = String(cashRows[0]["Account Number"] || "").trim()
  }

  const allSecSets: string[] = []
  const inModel: ImportHolding[] = []
  const unassigned: ImportHolding[] = []

  holdingRows.forEach(row => {
    const ticker = String(row["Ticker"] || "").trim().toUpperCase()
    if (!ticker || ticker === "CUSTODIAL_CASH") return

    const secSet      = String(row["Sec. Set"] || "").trim()
    const msCategory  = String(row["Product Sub-Class"] || "").trim()
    const productClass = String(row["Product Class"] || "").trim()
    const currentValue = parseFloat(String(row["Current $"] || "0")) || 0
    const currentShares = parseFloat(String(row["Current Shares"] || "0")) || 0
    const price        = parseFloat(String(row["Price"] || "0")) || 0
    const unrealizedGL = parseFloat(String(row["Unrealized G/L $"] || "0")) || 0
    const unrealizedGLPct = parseFloat(String(row["Unrealized G/L %"] || "0")) || 0
    const name         = String(row["Security Name"] || ticker).trim()
    const target       = targetMap.get(ticker) || { targetValue: 0, targetPct: 0 }

    allSecSets.push(secSet)

    const holding: ImportHolding = {
      ticker, name, secSet, msCategory, productClass,
      currentValue, currentShares, price,
      unrealizedGL, unrealizedGLPct,
      targetValue: target.targetValue,
      targetPct: target.targetPct,
    }

    if (secSet === "Unassigned") unassigned.push(holding)
    else if (secSet !== "Cash") inModel.push(holding)
  })

  return { accountNumber, modelName: inferModelName(allSecSets), inModel, unassigned }
}

// ─── Process with gains budget ────────────────────────────────────────────────
export function processWithBudget(result: ImportResult, gainsBudget: number | null): ProcessedHolding[] {
  const { unassigned, inModel } = result
  const processed: ProcessedHolding[] = []

  const losses = unassigned.filter(h => h.unrealizedGL <= 0)
  const gains  = unassigned.filter(h => h.unrealizedGL > 0).sort((a, b) => a.unrealizedGL - b.unrealizedGL)

  losses.forEach(h => processed.push({ holding: h, action: "sell-loss", matches: [] }))

  // Net the losses against the budget — losses offset gains dollar for dollar
  const totalLosses = losses.reduce((sum, h) => sum + Math.abs(h.unrealizedGL), 0)
  const effectiveBudget = (gainsBudget ?? 0) + totalLosses
  let budgetUsed = 0

  gains.forEach(h => {
    if (budgetUsed + h.unrealizedGL <= effectiveBudget) {
      budgetUsed += h.unrealizedGL
      processed.push({ holding: h, action: "sell-gain", matches: [], gainConsumed: h.unrealizedGL })
    } else {
      const matches = findMatches(h, inModel)
      processed.push({ holding: h, action: "map", matches })
    }
  })

  return processed
}

// ─── Export CSV ───────────────────────────────────────────────────────────────
export function exportImportCSV(processed: ProcessedHolding[], accountId: string): string {
  const rows = [["Account ID", "Targeted", "Equivalent", "Equivalent Buy Priority", "Equivalent Sell Priority", "Delete"]]
  processed.filter(p => p.action === "map" && p.matches.length > 0).forEach(p => {
    p.matches.forEach(m => {
      rows.push([accountId, m.ticker, p.holding.ticker, "Do Not Buy", "Default", ""])
    })
  })
  return rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n")
}
