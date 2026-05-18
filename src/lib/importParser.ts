import * as XLSX from "xlsx"

export interface ImportHolding {
  ticker: string
  name: string
  secSet: string          // e.g. "CRSP - US Equity" or "Unassigned"
  msCategory: string      // Product Sub-Class column
  currentValue: number    // Current $
  currentShares: number
  targetValue: number     // Target $ (from Asset Classification sheet)
  targetPct: number       // Target %
  unrealizedGL: number    // Unrealized G/L $
  unrealizedGLPct: number // Unrealized G/L %
  price: number
}

export interface ImportResult {
  accountNumber: string
  modelName: string       // inferred from Sec. Set labels
  inModel: ImportHolding[]
  unassigned: ImportHolding[]
}

export interface ProcessedHolding {
  holding: ImportHolding
  action: "sell-loss" | "sell-gain" | "map"
  mappedTo?: string       // ticker in model
  mappedName?: string
  gainConsumed?: number
}

// Infer a friendly model name from the Sec. Set labels present
function inferModelName(secSets: string[]): string {
  const unique = Array.from(new Set(secSets.filter(s => s && s !== "Unassigned" && s !== "Cash")))
  if (!unique.length) return "Unknown Model"

  // Strip the asset class suffix (e.g. "CRSP - US Equity" → "CRSP")
  const prefixes = unique.map(s => s.split(" - ")[0].trim())
  const uniquePrefixes = Array.from(new Set(prefixes))

  if (uniquePrefixes.length === 1) return uniquePrefixes[0]
  return uniquePrefixes.join(" / ")
}

export function parseImportExcel(buffer: ArrayBuffer): ImportResult {
  const wb = XLSX.read(buffer, { type: "array" })

  // ── Holding and Trade Details sheet ──────────────────────────────────────
  const holdingSheet = wb.Sheets["Holding and Trade Details"]
  if (!holdingSheet) throw new Error("Could not find 'Holding and Trade Details' sheet")

  const holdingRows = XLSX.utils.sheet_to_json<Record<string, string | number>>(
    holdingSheet, { defval: "" }
  )

  // ── Asset Classification sheet for target $ ───────────────────────────────
  const assetSheet = wb.Sheets["Asset Classification"]
  const targetMap = new Map<string, { targetValue: number; targetPct: number }>()
  if (assetSheet) {
    const assetRows = XLSX.utils.sheet_to_json<Record<string, string | number>>(assetSheet, { defval: "" })
    assetRows.forEach(row => {
      const ticker = String(row["Security"] || "").trim().toUpperCase()
      if (ticker) {
        targetMap.set(ticker, {
          targetValue: parseFloat(String(row["Target $"] || "0")) || 0,
          targetPct: parseFloat(String(row["Target %"] || "0")) || 0,
        })
      }
    })
  }

  // ── Account and Cash Details for account number ───────────────────────────
  const cashSheet = wb.Sheets["Account and Cash Details"]
  let accountNumber = ""
  if (cashSheet) {
    const cashRows = XLSX.utils.sheet_to_json<Record<string, string | number>>(cashSheet, { defval: "" })
    if (cashRows.length > 0) {
      accountNumber = String(cashRows[0]["Account Number"] || "").trim()
    }
  }

  // ── Parse holdings ─────────────────────────────────────────────────────────
  const allSecSets: string[] = []
  const inModel: ImportHolding[] = []
  const unassigned: ImportHolding[] = []

  holdingRows.forEach(row => {
    const ticker = String(row["Ticker"] || "").trim().toUpperCase()
    if (!ticker || ticker === "CUSTODIAL_CASH") return

    const secSet = String(row["Sec. Set"] || "").trim()
    const msCategory = String(row["Product Sub-Class"] || "").trim()
    const currentValue = parseFloat(String(row["Current $"] || "0")) || 0
    const currentShares = parseFloat(String(row["Current Shares"] || "0")) || 0
    const price = parseFloat(String(row["Price"] || "0")) || 0
    const unrealizedGL = parseFloat(String(row["Unrealized G/L $"] || "0")) || 0
    const unrealizedGLPct = parseFloat(String(row["Unrealized G/L %"] || "0")) || 0
    const name = String(row["Security Name"] || ticker).trim()

    const target = targetMap.get(ticker) || { targetValue: 0, targetPct: 0 }

    allSecSets.push(secSet)

    const holding: ImportHolding = {
      ticker, name, secSet, msCategory,
      currentValue, currentShares, price,
      unrealizedGL, unrealizedGLPct,
      targetValue: target.targetValue,
      targetPct: target.targetPct,
    }

    if (secSet === "Unassigned") {
      unassigned.push(holding)
    } else if (secSet !== "Cash") {
      inModel.push(holding)
    }
  })

  const modelName = inferModelName(allSecSets)

  return { accountNumber, modelName, inModel, unassigned }
}

// ── Gains budget processing ────────────────────────────────────────────────────
export function processWithBudget(
  result: ImportResult,
  gainsBudget: number | null
): ProcessedHolding[] {
  const { unassigned, inModel } = result
  const processed: ProcessedHolding[] = []

  // Separate losses from gains
  const losses = unassigned.filter(h => h.unrealizedGL <= 0)
  const gains = unassigned.filter(h => h.unrealizedGL > 0)
    .sort((a, b) => a.unrealizedGL - b.unrealizedGL) // lowest gain first

  // Losses → always sell
  losses.forEach(h => {
    processed.push({ holding: h, action: "sell-loss" })
  })

  // Gains → sell up to budget, then map remainder
  let budgetUsed = 0
  const effectiveBudget = gainsBudget ?? Infinity

  gains.forEach(h => {
    const glAmount = h.unrealizedGL
    if (budgetUsed + glAmount <= effectiveBudget) {
      // Can sell within budget
      budgetUsed += glAmount
      processed.push({ holding: h, action: "sell-gain", gainConsumed: glAmount })
    } else {
      // Over budget — map as equivalent
      const match = findBestMatch(h, inModel)
      processed.push({
        holding: h,
        action: "map",
        mappedTo: match?.ticker,
        mappedName: match?.name,
      })
    }
  })

  return processed
}

// Simple matching: same msCategory first, then same broad asset class
function findBestMatch(holding: ImportHolding, inModel: ImportHolding[]): ImportHolding | null {
  if (!inModel.length) return null

  // Try exact msCategory match first
  const exactMatch = inModel.find(m =>
    m.msCategory.toLowerCase() === holding.msCategory.toLowerCase()
  )
  if (exactMatch) return exactMatch

  // Try broad asset class match (first word of secSet after " - ")
  const holdingClass = holding.msCategory.toLowerCase()
  const classMatch = inModel.find(m => {
    const mClass = m.msCategory.toLowerCase()
    return (
      (holdingClass.includes("equity") && mClass.includes("equity")) ||
      (holdingClass.includes("bond") && mClass.includes("bond")) ||
      (holdingClass.includes("international") && mClass.includes("international")) ||
      (holdingClass.includes("emerging") && mClass.includes("emerging")) ||
      (holdingClass.includes("fixed") && mClass.includes("fixed"))
    )
  })
  return classMatch || inModel[0]
}

// ── Export to AccountEquivalent CSV ───────────────────────────────────────────
export function exportImportCSV(
  processed: ProcessedHolding[],
  accountId: string
): string {
  const rows = [["Account ID", "Targeted", "Equivalent", "Equivalent Buy Priority", "Equivalent Sell Priority", "Delete"]]

  processed
    .filter(p => p.action === "map" && p.mappedTo)
    .forEach(p => {
      rows.push([accountId, p.mappedTo!, p.holding.ticker, "Do Not Buy", "Default", ""])
    })

  return rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n")
}
