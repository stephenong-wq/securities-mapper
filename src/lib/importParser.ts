import * as XLSX from "xlsx"

export interface ImportHolding {
  ticker: string
  name: string
  secSet: string
  msCategory: string
  productClass: string
  modelCategory: string
  modelClass: string
  currentValue: number
  currentShares: number
  targetValue: number
  targetPct: number
  unrealizedGL: number
  unrealizedGLPct: number
  unrealizedGLST: number
  unrealizedGLLT: number
  isLongTerm: boolean
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
  weight?: number
}

export interface AccountData {
  accountId: string
  accountNumber: string
  regType: string
  isRetirement: boolean   // true = IRA/401k/Roth/etc — no tax cost on sells
  modelName: string
  inModel: ImportHolding[]
  unassigned: ImportHolding[]
  cashValue: number
  cashTarget: number
}

function classifyRetirement(regType: string): boolean {
  return /ira|401k|roth|403b|sep|simple|pension|retirement/i.test(regType)
}

export interface ImportResult {
  accounts: AccountData[]
  modelName: string
}

export interface ProcessedHolding {
  holding: ImportHolding
  action: "sell-loss" | "sell-gain" | "map"
  matches: ImportMatch[]
  gainConsumed?: number
  mapScore: number  // 0-10, higher = better match, used for sell priority
}

// ─── Extract model name from Model Category ───────────────────────────────────
function extractModelName(modelCategories: string[]): string {
  const categories = modelCategories.filter(s => s && s !== "Unassigned" && s !== "Cash")
  if (!categories.length) return "Unknown Model"
  const assetClassSuffixes = [
    /\s+(US\s+)?Fixed Income$/i, /\s+International\s+Fixed Income$/i,
    /\s+(US\s+)?Equity$/i, /\s+International\s+Equity$/i,
    /\s+Sector\s+Equity$/i, /\s+Alternatives$/i,
    /\s+US\s+Small\s+Cap$/i, /\s+Emerging\s+Markets$/i,
    /\s+US\s+Large\s+Cap$/i, /\s+High\s+Yield.*$/i,
    /\s+Cash\s+Equivalents$/i, /\s+Commodities$/i,
    /\s+Intl\s+Developed.*$/i, /\s+U\.S\.\s+Investment.*$/i,
  ]
  const stripped = categories.map(cat => {
    let s = cat
    for (const suffix of assetClassSuffixes) s = s.replace(suffix, "")
    return s.trim()
  })
  const counts = new Map<string, number>()
  stripped.forEach(s => counts.set(s, (counts.get(s) || 0) + 1))
  let best = ""; let bestCount = 0
  counts.forEach((count, name) => { if (count > bestCount) { best = name; bestCount = count } })
  return best || categories[0]
}

// ─── Index fingerprinting ─────────────────────────────────────────────────────
export function indexFingerprint(name: string): string[] {
  const n = name.toLowerCase()
    .replace(/ishares|vanguard|schwab|spdr|invesco|fidelity|dimensional|avantis|jpmorgan|wisdomtree|first trust|blackrock|pimco|state street|columbia|pacer|global x|franklin|nuveen|abrdn|goldman sachs|janus|thornburg|oakmark|shelton|dfa/gi, "")
    .replace(/etf|fund|trust|index|portfolio|series|instl|adv|institutional|admiral/gi, "")
    .trim()

  const signals: string[] = []
  if (/s&p\s*500|sp500/.test(n))             signals.push("sp500")
  if (/total\s*(stock|market|us)/.test(n))    signals.push("total-us")
  if (/russell\s*2000/.test(n))               signals.push("russell2000")
  if (/nasdaq|qqq/.test(n))                   signals.push("nasdaq100")
  if (/value/.test(n))                        signals.push("value")
  if (/growth/.test(n))                       signals.push("growth")
  if (/equal\s*weight/.test(n))               signals.push("equal-weight")
  if (/momentum/.test(n))                     signals.push("momentum")
  if (/quality/.test(n))                      signals.push("quality")
  if (/small[\s-]cap/.test(n))               signals.push("small-cap")
  if (/eafe/.test(n))                         signals.push("eafe")
  if (/emerging/.test(n))                     signals.push("emerging")
  if (/ex[\s-]china/.test(n))                signals.push("ex-china")
  if (/international|intl/.test(n))           signals.push("international")
  if (/aggregate|agg/.test(n))               signals.push("aggregate")
  if (/treasury|govt/.test(n))               signals.push("treasury")
  if (/tips|inflation/.test(n))              signals.push("tips")
  if (/high\s*yield/.test(n))                signals.push("high-yield")
  if (/muni|municipal/.test(n))              signals.push("muni")
  if (/mortgage|mbs/.test(n))               signals.push("mbs")
  if (/short[\s-]term/.test(n))             signals.push("short-term")
  if (/long[\s-]term|10[\s-]20|20\+/.test(n)) signals.push("long-term")
  if (/intermediate/.test(n))               signals.push("intermediate")
  if (/convertible/.test(n))               signals.push("convertible")
  if (/gold/.test(n))                       signals.push("commodity-gold")
  if (/commodity/.test(n))                  signals.push("commodity-broad")
  if (/technology|tech/.test(n))            signals.push("sector-tech")
  if (/defense|aerospace/.test(n))          signals.push("defense")
  if (/dividend/.test(n))                   signals.push("dividend")
  if (/core/.test(n))                       signals.push("core")
  return signals
}

function fingerprintOverlap(a: string[], b: string[]): number {
  const setA = new Set(a)
  return b.filter(x => setA.has(x)).length
}

function broadClass(category: string, productClass: string): string {
  const cat = (category + " " + productClass).toLowerCase()
  if (cat.includes("emerging")) return "emerging"
  if (isGlobal(category, productClass)) return "global"
  if (cat.includes("international") || cat.includes("foreign") || cat.includes("eafe")) return "intl-developed"
  if (cat.includes("bond") || cat.includes("fixed") || cat.includes("muni") || cat.includes("treasury") ||
      cat.includes("securitized") || cat.includes("mortgage") || cat.includes("taxable bonds") ||
      cat.includes("government") || cat.includes("high yield bond")) return "fixed-income"
  if (cat.includes("real estate") || cat.includes("commodity") || cat.includes("gold") || cat.includes("alternative")) return "real-assets"
  if (cat.includes("sector") || cat.includes("technology") || cat.includes("industrials")) return "sector"
  if (cat.includes("small")) return "us-small"
  if (cat.includes("mid")) return "us-mid"
  return "us-equity"
}

function isGlobal(category: string, productClass: string): boolean {
  const cat = (category + " " + productClass).toLowerCase()
  return cat.includes("global large") || cat.includes("global stock") || cat.includes("global equity") ||
    cat.includes("world large") || cat.includes("world stock") ||
    (cat.includes("global") && (cat.includes("equity") || cat.includes("stock") || cat.includes("blend")))
}

// ─── Score a candidate match (0-10) ───────────────────────────────────────────
function scoreCandidate(holding: ImportHolding, candidate: ImportHolding, maxUnderweight: number): number {
  let score = 0
  const hFp = indexFingerprint(holding.name)
  const cFp = indexFingerprint(candidate.name)
  score += fingerprintOverlap(hFp, cFp) * 2
  if (holding.msCategory.toLowerCase() === candidate.msCategory.toLowerCase()) score += 5
  if (broadClass(holding.msCategory, holding.productClass) === broadClass(candidate.msCategory, candidate.productClass)) score += 3
  const underweight = Math.max(0, candidate.targetValue - candidate.currentValue)
  if (maxUnderweight > 0) score += (underweight / maxUnderweight) * 4
  return score
}

// ─── Get overall best map score for a holding ─────────────────────────────────
export function getBestMapScore(holding: ImportHolding, inModel: ImportHolding[]): number {
  if (!inModel.length) return 0
  const maxUnderweight = Math.max(...inModel.map(m => Math.max(0, m.targetValue - m.currentValue)))
  return Math.max(...inModel.map(c => scoreCandidate(holding, c, maxUnderweight)))
}

export function findMatches(holding: ImportHolding, inModel: ImportHolding[]): ImportMatch[] {
  if (!inModel.length) return []
  const maxUnderweight = Math.max(...inModel.map(m => Math.max(0, m.targetValue - m.currentValue)))
  const holdingBroadClass = broadClass(holding.msCategory, holding.productClass)

  // Global fund → split across US + EAFE + EM
  if (holdingBroadClass === "global") {
    const globalScored = inModel.map(candidate => ({
      candidate, score: scoreCandidate(holding, candidate, maxUnderweight),
      underweightValue: Math.max(0, candidate.targetValue - candidate.currentValue),
      broadClass: broadClass(candidate.msCategory, candidate.productClass),
    }))
    const usMatch   = globalScored.filter(s => s.broadClass === "us-equity" || s.broadClass === "us-small" || s.broadClass === "us-mid").sort((a,b) => b.score - a.score)[0]
    const eafeMatch = globalScored.filter(s => s.broadClass === "intl-developed").sort((a,b) => b.score - a.score)[0]
    const emMatch   = globalScored.filter(s => s.broadClass === "emerging").sort((a,b) => b.score - a.score)[0]
    const globalMatches = [usMatch, eafeMatch, emMatch].filter(Boolean)
    if (globalMatches.length > 0) {
      const totalUnderweight = globalMatches.reduce((s, m) => s + m!.underweightValue, 0)
      return globalMatches.map(m => ({
        ticker: m!.candidate.ticker, name: m!.candidate.name, msCategory: m!.candidate.msCategory,
        targetValue: m!.candidate.targetValue, currentValue: m!.candidate.currentValue,
        underweightValue: m!.underweightValue, score: m!.score,
        weight: totalUnderweight > 0 ? m!.underweightValue / totalUnderweight : 1 / globalMatches.length,
      }))
    }
  }

  const scored = inModel.map(candidate => ({
    candidate, score: scoreCandidate(holding, candidate, maxUnderweight),
    underweightValue: Math.max(0, candidate.targetValue - candidate.currentValue),
    broadClass: broadClass(candidate.msCategory, candidate.productClass),
  })).sort((a, b) => b.score - a.score)

  const top = scored[0]
  if (!top || top.score === 0) return []
  const second = scored[1]
  const shouldSplit = second && second.score >= top.score * 0.7 &&
    second.broadClass !== top.broadClass && holdingBroadClass !== top.broadClass
  const toMatch = shouldSplit ? [top, second] : [top]
  const totalUnderweight = toMatch.reduce((s, m) => s + m.underweightValue, 0)
  return toMatch.map(m => ({
    ticker: m.candidate.ticker, name: m.candidate.name, msCategory: m.candidate.msCategory,
    targetValue: m.candidate.targetValue, currentValue: m.candidate.currentValue,
    underweightValue: m.underweightValue, score: m.score,
    weight: toMatch.length > 1 ? (totalUnderweight > 0 ? m.underweightValue / totalUnderweight : 0.5) : undefined,
  }))
}

// ─── Parse Excel ──────────────────────────────────────────────────────────────
export function parseImportExcel(buffer: ArrayBuffer): ImportResult {
  const wb = XLSX.read(buffer, { type: "array" })

  const holdingSheet = wb.Sheets["Holding and Trade Details"]
  if (!holdingSheet) throw new Error("Could not find 'Holding and Trade Details' sheet")
  const holdingRows = XLSX.utils.sheet_to_json<Record<string, string | number>>(holdingSheet, { defval: "" })

  const assetSheet = wb.Sheets["Asset Classification"]
  const targetMap = new Map<string, { targetValue: number; targetPct: number }>()
  let cashTargetFromSheet = 0
  if (assetSheet) {
    const assetRows = XLSX.utils.sheet_to_json<Record<string, string | number>>(assetSheet, { defval: "" })
    assetRows.forEach(row => {
      const ticker = String(row["Security"] || "").trim().toUpperCase()
      if (!ticker) return
      if (ticker === "CASH") {
        cashTargetFromSheet = parseFloat(String(row["Target $"] || "0")) || 0
        return
      }
      targetMap.set(ticker, {
        targetValue: parseFloat(String(row["Target $"] || "0")) || 0,
        targetPct: parseFloat(String(row["Target %"] || "0")) || 0,
      })
    })
  }

  const regTypeMap = new Map<string, string>()
  const cashSheet = wb.Sheets["Account and Cash Details"]
  if (cashSheet) {
    const cashRows = XLSX.utils.sheet_to_json<Record<string, string | number>>(cashSheet, { defval: "" })
    cashRows.forEach(row => {
      const acct = String(row["Account Number"] || "").trim()
      const reg = String(row["Reg Type"] || row["Registration Type"] || "").trim()
      if (acct) regTypeMap.set(acct, reg)
    })
  }

  const accountMap = new Map<string, {
    accountNumber: string
    modelCategories: string[]
    inModel: ImportHolding[]
    unassigned: ImportHolding[]
    cashValue: number
    cashTarget: number
  }>()

  holdingRows.forEach(row => {
    const ticker = String(row["Ticker"] || "").trim().toUpperCase()
    if (!ticker) return

    const accountNumber  = String(row["Account Number"] || "").trim()
    const secSet         = String(row["Sec. Set"] || "").trim()
    const msCategory     = String(row["Product Sub-Class"] || "").trim()
    const productClass   = String(row["Product Class"] || "").trim()
    const modelCategory  = String(row["Model Category"] || "").trim()
    const modelClass     = String(row["Model Class"] || "").trim()
    const name           = String(row["Security Name"] || ticker).trim()
    const currentValue   = parseFloat(String(row["Current $"] || "0")) || 0
    const currentShares  = parseFloat(String(row["Current Shares"] || "0")) || 0
    const price          = parseFloat(String(row["Price"] || "0")) || 0
    const unrealizedGL   = parseFloat(String(row["Unrealized G/L $"] || "0")) || 0
    const unrealizedGLPct= parseFloat(String(row["Unrealized G/L %"] || "0")) || 0
    const unrealizedGLST = parseFloat(String(row["Unrealized G/L ST $"] || "0")) || 0
    const unrealizedGLLT = parseFloat(String(row["Unrealized G/L LT $"] || "0")) || 0
    const isLongTerm     = Math.abs(unrealizedGLLT) >= Math.abs(unrealizedGLST)
    const target         = targetMap.get(ticker) || { targetValue: 0, targetPct: 0 }

    if (!accountMap.has(accountNumber)) {
      accountMap.set(accountNumber, { accountNumber, modelCategories: [], inModel: [], unassigned: [], cashValue: 0, cashTarget: 0 })
    }
    const acct = accountMap.get(accountNumber)!
    if (modelCategory && modelCategory !== "Unassigned" && modelCategory !== "Cash") {
      acct.modelCategories.push(modelCategory)
    }

    const holding: ImportHolding = {
      ticker, name, secSet, msCategory, productClass, modelCategory, modelClass,
      currentValue, currentShares, price,
      unrealizedGL, unrealizedGLPct, unrealizedGLST, unrealizedGLLT, isLongTerm,
      targetValue: target.targetValue, targetPct: target.targetPct,
    }

    if (secSet === "Unassigned") acct.unassigned.push(holding)
    else if (secSet === "Cash" || ticker === "CUSTODIAL_CASH") {
      acct.cashValue = (acct.cashValue || 0) + currentValue
    }
    else acct.inModel.push(holding)
  })

  const allModelCategories = Array.from(accountMap.values()).flatMap(a => a.modelCategories)
  const overallModelName = extractModelName(allModelCategories)

  // Distribute cash target proportionally across accounts by account value
  const totalAccountValue = Array.from(accountMap.values()).reduce((s, d) =>
    s + [...d.inModel, ...d.unassigned].reduce((ss, h) => ss + h.currentValue, 0) + (d.cashValue || 0), 0)

  const accounts: AccountData[] = Array.from(accountMap.entries()).map(([accountNumber, data]) => {
    const acctValue = [...data.inModel, ...data.unassigned].reduce((s, h) => s + h.currentValue, 0) + (data.cashValue || 0)
    const cashTargetShare = totalAccountValue > 0 ? (acctValue / totalAccountValue) * cashTargetFromSheet : 0
    const regType = regTypeMap.get(accountNumber) || ""
    return {
      accountId: accountNumber, accountNumber,
      regType,
      isRetirement: classifyRetirement(regType),
      modelName: extractModelName(data.modelCategories),
      inModel: data.inModel,
      unassigned: data.unassigned,
      cashValue: data.cashValue || 0,
      cashTarget: cashTargetShare,
    }
  })

  return { accounts, modelName: overallModelName }
}

// ─── Process with gains budget ────────────────────────────────────────────────
// Priority: 1) losses (always sell), 2) poor matches (sell up to budget, lowest gain first),
//           3) decent matches (sell up to budget), 4) strong matches (keep as equivalent)
export function processWithBudget(
  account: AccountData,
  gainsBudget: number | null,
  userMappings: Record<string, string> = {}
): ProcessedHolding[] {
  const { unassigned, inModel } = account
  const processed: ProcessedHolding[] = []

  // Helper: resolve matches respecting userMappings overrides
  const resolveMatches = (h: ImportHolding): ImportMatch[] => {
    const override = userMappings[h.ticker]
    if (override) {
      const tickers = override.split(/\s*\/\s*/).map((t: string) => t.trim()).filter(Boolean)
      const matched = tickers.map((ticker: string) => inModel.find(m => m.ticker === ticker)).filter(Boolean) as ImportHolding[]
      if (matched.length > 0) {
        const totalTarget = matched.reduce((s: number, m: ImportHolding) => s + m.targetValue, 0)
        return matched.map((m: ImportHolding) => ({
          ticker: m.ticker, name: m.name, msCategory: m.msCategory,
          targetValue: m.targetValue, currentValue: m.currentValue,
          underweightValue: Math.max(0, m.targetValue - m.currentValue),
          score: 10,
          weight: totalTarget > 0 ? m.targetValue / totalTarget : 1 / matched.length,
        }))
      }
    }
    return findMatches(h, inModel)
  }

  // Losses always sell (free — no budget impact for taxable, irrelevant for retirement)
  const losses = unassigned.filter(h => h.unrealizedGL <= 0)
  losses.forEach(h => {
    processed.push({ holding: h, action: "sell-loss", matches: resolveMatches(h), mapScore: getBestMapScore(h, inModel) })
  })

  const gains = unassigned.filter(h => h.unrealizedGL > 0).map(h => ({
    holding: h,
    matches: resolveMatches(h),
    mapScore: userMappings[h.ticker] ? 10 : getBestMapScore(h, inModel),
  }))

  if (account.isRetirement) {
    // Retirement account: no tax cost — sell everything freely, no budget needed
    gains.forEach(({ holding, matches, mapScore }) => {
      processed.push({ holding, action: "sell-gain", matches, gainConsumed: 0, mapScore })
    })
  } else if (!gainsBudget || gainsBudget <= 0) {
    // Taxable with no budget: map all gains as equivalents
    gains.forEach(({ holding, matches, mapScore }) => {
      processed.push({ holding, action: "map", matches, mapScore })
    })
  } else {
    // Taxable with budget: sell worst-matched first, lowest gain within tier
    // NOTE: actual budget tracking happens cross-account in the route/engine
    // Here we mark all as sell-gain; engine will respect the combined budget
    const sorted = [...gains].sort((a, b) => {
      const sd = a.mapScore - b.mapScore
      if (Math.abs(sd) > 1) return sd
      return a.holding.unrealizedGL - b.holding.unrealizedGL
    })
    sorted.forEach(({ holding, matches, mapScore }) => {
      processed.push({ holding, action: "sell-gain", matches, gainConsumed: holding.unrealizedGL, mapScore })
    })
  }

  return processed
}

// ─── Multi-account budget enforcement ────────────────────────────────────────
// After per-account processing, enforce the combined gains budget across all
// taxable accounts. IRA gains are free. Taxable gains consume the budget.
export function enforceCombinedBudget(
  processedAccounts: { account: AccountData; processed: ProcessedHolding[] }[],
  gainsBudget: number | null
): void {
  if (!gainsBudget && gainsBudget !== 0) return  // null = unlimited

  // Step 1: count losses from taxable accounts (offset budget)
  const taxableLosses = processedAccounts
    .filter(pa => !pa.account.isRetirement)
    .flatMap(pa => pa.processed.filter(p => p.action === "sell-loss"))
    .reduce((s, p) => s + Math.abs(p.holding.unrealizedGL), 0)

  const effectiveBudget = gainsBudget + taxableLosses
  let budgetUsed = 0

  // Step 2: collect all taxable sell-gain candidates across all accounts
  // Sort: worst match first (lowest mapScore), then lowest gain
  const candidates: { pa: { account: AccountData; processed: ProcessedHolding[] }; p: ProcessedHolding; idx: number }[] = []
  processedAccounts.filter(pa => !pa.account.isRetirement).forEach(pa => {
    pa.processed.forEach((p, idx) => {
      if (p.action === "sell-gain") candidates.push({ pa, p, idx })
    })
  })
  candidates.sort((a, b) => {
    const sd = a.p.mapScore - b.p.mapScore
    if (Math.abs(sd) > 1) return sd
    return a.p.holding.unrealizedGL - b.p.holding.unrealizedGL
  })

  // Step 3: allow sells up to budget, convert rest to "map"
  candidates.forEach(({ pa, p, idx }) => {
    if (budgetUsed + p.holding.unrealizedGL <= effectiveBudget) {
      budgetUsed += p.holding.unrealizedGL
      pa.processed[idx] = { ...p, gainConsumed: p.holding.unrealizedGL }
    } else {
      pa.processed[idx] = { ...p, action: "map", gainConsumed: 0 }
    }
  })
}


// ─── Export CSV ───────────────────────────────────────────────────────────────
export function exportImportCSV(processedAccounts: { accountId: string; processed: ProcessedHolding[] }[], editedMappings: Record<string, string>): string {
  const rows = [["Account ID", "Targeted", "Equivalent", "Equivalent Buy Priority", "Equivalent Sell Priority", "Delete"]]
  processedAccounts.forEach(({ accountId, processed }) => {
    processed.filter(p => (p.action === "map" || p.action === "sell-gain") && p.matches.length > 0).forEach(p => {
      const editedValue = editedMappings[p.holding.ticker]
      if (editedValue) {
        editedValue.split(/\s*\/\s*/).map(t => t.trim()).filter(Boolean).forEach(ticker => {
          rows.push([accountId, ticker, p.holding.ticker, "Do Not Buy", "Default", ""])
        })
      } else {
        p.matches.forEach(m => {
          rows.push([accountId, m.ticker, p.holding.ticker, "Do Not Buy", "Default", ""])
        })
      }
    })
  })
  return rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n")
}
