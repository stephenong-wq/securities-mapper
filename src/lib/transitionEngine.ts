import type { AccountData, ImportHolding, ProcessedHolding, ImportMatch } from "./importParser"

export const TAX_RATE_LT = 0.238
export const TAX_RATE_ST = 0.408
export const TOLERANCE_BAND = 0.25          // 25% of target — e.g. 10% target → 7.5%-12.5% band
export const EQUITY_IN_RETIREMENT = 0.70    // target 70% of equity allocation in retirement accounts  // ±5%

export interface TradeRow {
  id: string
  accountId: string
  accountNumber: string
  ticker: string
  securityName: string
  tradeType: "buy" | "sell" | "equivalent"  // equivalent = mapped, no trade
  tradeAmount: number
  editTradeAmount?: number   // user override
  currentValue: number
  targetValue: number
  unrealizedGL: number
  unrealizedGLST: number
  unrealizedGLLT: number
  isLongTerm: boolean
  realizedGL: number
  realizedGLST: number
  realizedGLLT: number
  estimatedTax: number
  msCategory: string
  productClass: string
  assetClass: string
  mappedTicker: string
  mappedName: string
  isSell: boolean
  isKeep: boolean
  isEquivalent: boolean   // true = mapped equivalent, no actual trade
  mapScore: number
  userOverride: boolean
}

export interface AssetClassGroup {
  assetClass: string
  currentValue: number
  targetValue: number
  postTradeValue: number
  totalValue: number
  currentPct: number
  targetPct: number
  postTradePct: number
  tradeAmount: number
  inTolerance: boolean
  holdings: HoldingRow[]
}

export interface EquivRow {
  ticker: string
  securityName: string
  currentValue: number
  equivalentOf: string   // target ticker this maps to
  unrealizedGL: number
}

export interface HoldingRow {
  ticker: string
  securityName: string
  currentValue: number        // raw holding value (0 if not held directly)
  equivalentValue: number     // sum of all equivalents mapped to this ticker
  effectiveCurrent: number    // currentValue + equivalentValue
  targetValue: number
  postTradeValue: number
  tradeAmount: number
  isEquivalent: boolean
  equivalentOf?: string
  unrealizedGL: number
  realizedGL: number
  estimatedTax: number
  equivalents: EquivRow[]    // nested equivalents mapped to this security
}

export interface TransitionSummary {
  clientName: string
  modelName: string
  date: string
  totalValue: number
  totalTradeGL: number
  estimatedTax: number
  taxImpactPct: number
  ltGains: number
  stGains: number
  losses: number
  numTrades: number
  totalRealizedGL: number
  netCashFromTrades: number  // sells - buys = net cash change
  currentCash: number
  assetAllocation: AssetAllocationRow[]
  assetGroups: AssetClassGroup[]
  trades: TradeRow[]
  accounts: { accountId: string; accountNumber: string; regType: string; value: number }[]
}

export interface AssetAllocationRow {
  assetClass: string
  currentValue: number
  currentPct: number
  targetPct: number
  postTradePct: number
  tradeAmount: number
  inTolerance: boolean
}

// ─── Asset class helpers ─────────────────────────────────────────────────────
function isEquityClass(assetClass: string): boolean {
  return /equity|markets|large cap|small cap/i.test(assetClass) &&
    !/fixed income|bond|alternative|commodity/i.test(assetClass)
}

function isFixedIncomeClass(assetClass: string): boolean {
  return /fixed income|bond|investment grade|high yield/i.test(assetClass)
}

// ─── Asset class from Model Class ─────────────────────────────────────────────
export function inferDisplayAssetClass(msCategory: string, productClass: string, modelClass: string): string {
  if (modelClass && modelClass !== "Unassigned" && modelClass !== "Cash" && modelClass !== "N/A") {
    const suffixPatterns = [
      /(?:.*?)\s+(US Fixed Income)$/i,
      /(?:.*?)\s+(International Fixed Income)$/i,
      /(?:.*?)\s+(US Equity)$/i,
      /(?:.*?)\s+(International Equity)$/i,
      /(?:.*?)\s+(Sector Equity)$/i,
      /(?:.*?)\s+(Alternatives)$/i,
      /(?:.*?)\s+(US Small Cap)$/i,
      /(?:.*?)\s+(Emerging Markets)$/i,
      /(?:.*?)\s+(US Large Cap)$/i,
      /(?:.*?)\s+(High Yield Corporate Bonds)$/i,
      /(?:.*?)\s+(Cash Equivalents)$/i,
      /(?:.*?)\s+(Commodities)$/i,
      /(?:.*?)\s+(Intl Developed ex-US Market)$/i,
      /(?:.*?)\s+(U\.S\. Investment Grade FI)$/i,
    ]
    for (const pattern of suffixPatterns) {
      const match = modelClass.match(pattern)
      if (match) return match[1]
    }
    const parts = modelClass.trim().split(/\s+/)
    if (parts.length > 2) {
      const last3 = parts.slice(-3).join(" ")
      const last2 = parts.slice(-2).join(" ")
      const assetWords = ["equity", "income", "bonds", "markets", "cap", "alternatives", "commodities"]
      if (assetWords.some(w => last2.toLowerCase().includes(w))) return last3
    }
  }
  const cat = (msCategory + " " + productClass).toLowerCase()
  if (cat.includes("emerging")) return "Emerging Markets"
  if (cat.includes("international") || cat.includes("foreign") || cat.includes("eafe")) return "International Equity"
  if (cat.includes("high yield")) return "High Yield Corporate Bonds"
  if (cat.includes("bond") || cat.includes("fixed") || cat.includes("muni") || cat.includes("treasury") ||
      cat.includes("securitized") || cat.includes("mortgage")) return "US Fixed Income"
  if (cat.includes("commodity") || cat.includes("gold")) return "Commodities"
  if (cat.includes("alternative")) return "Alternatives"
  if (cat.includes("sector") || cat.includes("technology")) return "Sector Equity"
  return "US Equity"
}

export function buildTransition(
  accounts: AccountData[],
  processedAccounts: { accountId: string; accountNumber: string; modelName: string; processed: ProcessedHolding[] }[],
  gainsBudget: number | null,
  clientName: string
): TransitionSummary {
  const modelName = processedAccounts[0]?.modelName || accounts[0]?.modelName || "Unknown Model"
  const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  const totalValue = accounts.reduce((sum, acct) =>
    sum + [...acct.inModel, ...acct.unassigned].reduce((s, h) => s + h.currentValue, 0), 0)

  const rawTrades: TradeRow[] = []

  // ── Asset Location Pre-pass ──────────────────────────────────────────────
  const retirementAccounts = accounts.filter(a => a.isRetirement)
  const taxableAccounts = accounts.filter(a => !a.isRetirement)
  const hasMultipleAccountTypes = retirementAccounts.length > 0 && taxableAccounts.length > 0

  const acctValue = (a: AccountData) =>
    [...a.inModel, ...a.unassigned].reduce((s, h) => s + h.currentValue, 0) + (a.cashValue || 0)

  const totalRetirementValue = retirementAccounts.reduce((s, a) => s + acctValue(a), 0)
  const totalTaxableValue = taxableAccounts.reduce((s, a) => s + acctValue(a), 0)

  // Total equity target across all in-model holdings
  const totalEquityTarget = accounts.reduce((s, a) =>
    s + a.inModel.filter(h => isEquityClass(inferDisplayAssetClass(h.msCategory, h.productClass, h.modelClass)))
      .reduce((ss, h) => ss + h.targetValue, 0), 0)

  // 70% of equity goes to retirement, capped at 95% of retirement capacity
  const equityToRetirement = hasMultipleAccountTypes
    ? Math.min(totalEquityTarget * EQUITY_IN_RETIREMENT, totalRetirementValue * 0.95)
    : totalEquityTarget
  const equityToTaxable = totalEquityTarget - equityToRetirement

  // Per-account equity budget
  const accountEquityBudget = new Map<string, number>()
  retirementAccounts.forEach(a => {
    accountEquityBudget.set(a.accountId, totalRetirementValue > 0 ? (acctValue(a) / totalRetirementValue) * equityToRetirement : 0)
  })
  taxableAccounts.forEach(a => {
    accountEquityBudget.set(a.accountId, totalTaxableValue > 0 ? (acctValue(a) / totalTaxableValue) * equityToTaxable : 0)
  })

  // Pre-build equivValueByTarget across ALL accounts
  // Maps target ticker -> total equivalent value satisfying it (split by weight for multi-match)
  const globalEquivByTarget = new Map<string, number>()
  processedAccounts.forEach(({ processed }) => {
    processed.filter(p => p.action === "map").forEach(p => {
      if (p.matches.length === 0) return
      p.matches.forEach(m => {
        const w = m.weight ?? (1 / p.matches.length)
        globalEquivByTarget.set(m.ticker, (globalEquivByTarget.get(m.ticker) || 0) + p.holding.currentValue * w)
      })
    })
  })

  processedAccounts.forEach(({ accountId, accountNumber, processed }) => {
    const account = accounts.find(a => a.accountId === accountId)
    if (!account) return

    processed.forEach(p => {
      const h = p.holding
      const isSellLoss = p.action === "sell-loss"
      const isSellGain = p.action === "sell-gain"
      const isMap = p.action === "map"
      const assetClass = inferDisplayAssetClass(h.msCategory, h.productClass, h.modelClass)

      if (isMap) {
        // Mapped equivalent — push one equiv trade per matched target
        // For multi-target mappings (e.g. "SPEM / XCEM"), split value by weight
        const matchList = p.matches.length > 0 ? p.matches : [{ ticker: "", name: "", msCategory: h.msCategory, weight: undefined as number | undefined, targetValue: 0, currentValue: 0, underweightValue: 0, score: 0 }]
        matchList.forEach((m, mi) => {
          const targetInModel = m.ticker ? account.inModel.find(im => im.ticker === m.ticker) : null
          const equivAssetClass = targetInModel
            ? inferDisplayAssetClass(m.msCategory, targetInModel.productClass, targetInModel.modelClass)
            : assetClass
          const weight = m.weight ?? (1 / matchList.length)
          const equivValue = h.currentValue * weight
          rawTrades.push({
            id: `${accountId}-${h.ticker}-equiv-${mi}`,
            accountId, accountNumber,
            ticker: h.ticker, securityName: h.name,
            tradeType: "equivalent", tradeAmount: 0,
            currentValue: equivValue, targetValue: 0,
            unrealizedGL: h.unrealizedGL * weight,
            unrealizedGLST: h.unrealizedGLST * weight,
            unrealizedGLLT: h.unrealizedGLLT * weight,
            isLongTerm: h.isLongTerm,
            realizedGL: 0, realizedGLST: 0, realizedGLLT: 0, estimatedTax: 0,
            msCategory: h.msCategory, productClass: h.productClass,
            assetClass: equivAssetClass,
            mappedTicker: m.ticker || "", mappedName: m.name || "",
            isSell: false, isKeep: false, isEquivalent: true, mapScore: p.mapScore, userOverride: false,
          })
        })
      } else {
        // Actual sell (loss or gain within budget)
        const realizedGL = h.unrealizedGL
        const realizedGLST = h.unrealizedGLST
        const realizedGLLT = h.unrealizedGLLT
        const estimatedTax = realizedGL > 0
          ? (realizedGLLT > 0 ? realizedGLLT * TAX_RATE_LT : 0) + (realizedGLST > 0 ? realizedGLST * TAX_RATE_ST : 0)
          : 0

        rawTrades.push({
          id: `${accountId}-${h.ticker}-sell`,
          accountId, accountNumber,
          ticker: h.ticker, securityName: h.name,
          tradeType: "sell", tradeAmount: -h.currentValue,
          currentValue: h.currentValue, targetValue: 0,
          unrealizedGL: h.unrealizedGL, unrealizedGLST: h.unrealizedGLST, unrealizedGLLT: h.unrealizedGLLT,
          isLongTerm: h.isLongTerm, realizedGL, realizedGLST, realizedGLLT, estimatedTax,
          msCategory: h.msCategory, productClass: h.productClass, assetClass,
          mappedTicker: p.matches[0]?.ticker || "", mappedName: p.matches[0]?.name || "",
          isSell: true, isKeep: false, isEquivalent: false, mapScore: p.mapScore, userOverride: false,
        })

        // Buy equivalent for sell-gain positions
        // Only buy if the target is still underweight after accounting for equivalents
        if (isSellGain && p.matches.length > 0) {
          p.matches.forEach(m => {
            const equivSatisfied = globalEquivByTarget.get(m.ticker) || 0
            const effectiveCurrent = m.currentValue + equivSatisfied
            const stillNeeded = m.targetValue - effectiveCurrent
            if (stillNeeded <= 100) return  // already satisfied by equivalents
            const buyAmt = Math.min(h.currentValue * (m.weight ?? 1), stillNeeded)
            rawTrades.push({
              id: `${accountId}-${m.ticker}-buy-${h.ticker}`,
              accountId, accountNumber,
              ticker: m.ticker, securityName: m.name,
              tradeType: "buy", tradeAmount: buyAmt,
              currentValue: m.currentValue, targetValue: m.targetValue,
              unrealizedGL: 0, unrealizedGLST: 0, unrealizedGLLT: 0, isLongTerm: true,
              realizedGL: 0, realizedGLST: 0, realizedGLLT: 0, estimatedTax: 0,
              msCategory: m.msCategory, productClass: "", assetClass: inferDisplayAssetClass(m.msCategory, "", ""),
              mappedTicker: m.ticker, mappedName: m.name,
              isSell: false, isKeep: false, isEquivalent: false, mapScore: 0, userOverride: false,
            })
          })
        }
      }
    })

    // ── Class-level rebalancing ──────────────────────────────────────────────
    // Group in-model holdings by asset class, compute class gap, generate trades.
    // Buys go to rawTrades (consolidated later). Sells only when class is overweight
    // beyond tolerance band. Never sell if we don't hold the security.

    const classGroups = new Map<string, typeof account.inModel>()
    account.inModel.forEach(h => {
      const ac = inferDisplayAssetClass(h.msCategory, h.productClass, h.modelClass)
      if (!classGroups.has(ac)) classGroups.set(ac, [])
      classGroups.get(ac)!.push(h)
    })

    classGroups.forEach((classHoldings, assetClass) => {
      // Only count in-model holdings as current (unassigned are being sold or kept as equiv)
      const classInModelCurrent = classHoldings.reduce((s, h) => s + h.currentValue, 0)
      // Equiv value = unassigned mapped positions that satisfy this class target
      const classEquivValue = classHoldings.reduce((s, h) => s + (globalEquivByTarget.get(h.ticker) || 0), 0)
      const classEffCurrent = classInModelCurrent + classEquivValue
      const classTarget = classHoldings.reduce((s, h) => s + h.targetValue, 0)
      const classGap = classTarget - classEffCurrent  // positive = underweight, negative = overweight

      if (classGap > 100) {
        // Asset location: cap equity buys per account based on asset location budget
        const isEquity = isEquityClass(assetClass)
        const acctEquityBudget = accountEquityBudget.get(accountId) || 0
        const acctEquityUsed = rawTrades
          .filter(t => t.tradeType === "buy" && t.accountId === accountId && isEquityClass(t.assetClass))
          .reduce((s, t) => s + t.tradeAmount, 0)
        const equityBudgetRemaining = isEquity
          ? Math.max(0, acctEquityBudget - acctEquityUsed)
          : Infinity
        const effectiveClassGap = isEquity ? Math.min(classGap, equityBudgetRemaining) : classGap
        if (effectiveClassGap < 100) return

        // Underweight — distribute buy across securities proportional to their gap
        const secGaps = classHoldings.map(h => {
          const equivSat = globalEquivByTarget.get(h.ticker) || 0
          return { h, gap: Math.max(0, h.targetValue - h.currentValue - equivSat) }
        })
        const totalSecGap = secGaps.reduce((s, x) => s + x.gap, 0)
        if (totalSecGap <= 0) return
        secGaps.forEach(({ h, gap }) => {
          if (gap <= 0) return
          const classShare = (gap / totalSecGap) * effectiveClassGap
          const buyAmt = Math.min(gap, classShare)
          if (buyAmt < 100) return
          rawTrades.push({
            id: `${accountId}-${h.ticker}-rebal`,
            accountId, accountNumber,
            ticker: h.ticker, securityName: h.name, tradeType: "buy", tradeAmount: buyAmt,
            currentValue: h.currentValue, targetValue: h.targetValue,
            unrealizedGL: h.unrealizedGL, unrealizedGLST: h.unrealizedGLST, unrealizedGLLT: h.unrealizedGLLT,
            isLongTerm: h.isLongTerm, realizedGL: 0, realizedGLST: 0, realizedGLLT: 0, estimatedTax: 0,
            msCategory: h.msCategory, productClass: h.productClass, assetClass,
            mappedTicker: h.ticker, mappedName: h.name,
            isSell: false, isKeep: true, isEquivalent: false, mapScore: 10, userOverride: false,
          })
        })
      } else if (classGap < -100 && classInModelCurrent > 0) {
        // Overweight — sell proportionally from securities we actually hold
        const overweight = Math.abs(classGap)
        classHoldings.filter(h => h.currentValue > 0).forEach(h => {
          const sellAmt = Math.min(h.currentValue, overweight * (h.currentValue / classInModelCurrent))
          if (sellAmt < 100) return
          const pr = sellAmt / h.currentValue
          const realizedGLLT = (h.unrealizedGLLT || 0) * pr
          const realizedGLST = (h.unrealizedGLST || 0) * pr
          const realizedGL = realizedGLLT + realizedGLST
          const estimatedTax = realizedGL > 0
            ? (realizedGLLT > 0 ? realizedGLLT * TAX_RATE_LT : 0) + (realizedGLST > 0 ? realizedGLST * TAX_RATE_ST : 0) : 0
          rawTrades.push({
            id: `${accountId}-${h.ticker}-rebal`,
            accountId, accountNumber,
            ticker: h.ticker, securityName: h.name, tradeType: "sell", tradeAmount: -sellAmt,
            currentValue: h.currentValue, targetValue: h.targetValue,
            unrealizedGL: h.unrealizedGL, unrealizedGLST: h.unrealizedGLST, unrealizedGLLT: h.unrealizedGLLT,
            isLongTerm: h.isLongTerm, realizedGL, realizedGLST, realizedGLLT, estimatedTax,
            msCategory: h.msCategory, productClass: h.productClass, assetClass,
            mappedTicker: h.ticker, mappedName: h.name,
            isSell: true, isKeep: true, isEquivalent: false, mapScore: 10, userOverride: false,
          })
        })
      }
    })
  })

  // ── Group buys by ticker (consolidate multiple buys for same security) ────
  const trades: TradeRow[] = []
  const buyMap = new Map<string, TradeRow>()
  rawTrades.forEach(t => {
    if (t.tradeType === "buy") {
      const key = `${t.accountId}-${t.ticker}`
      if (buyMap.has(key)) {
        buyMap.get(key)!.tradeAmount += t.tradeAmount
      } else {
        buyMap.set(key, { ...t })
      }
    } else {
      trades.push(t)
    }
  })

  // ── Cap total buys by available cash (currentCash + sellProceeds) ─────────
  // Then cap each class by its own target gap
  const totalSellProceeds = rawTrades
    .filter(t => t.tradeType === "sell")
    .reduce((s, t) => s + Math.abs(t.tradeAmount), 0)
  const totalCurrentCash = accounts.reduce((s, a) => s + (a.cashValue || 0), 0)
  const totalCashTarget = accounts.reduce((s, a) => s + (a.cashTarget || 0), 0)
  // Available to invest = cash above target + sell proceeds
  const cashAboveTarget = Math.max(0, totalCurrentCash - totalCashTarget)
  let availableCash = cashAboveTarget + totalSellProceeds

  // Group buyMap by asset class, sort classes by underweight (most underweight first)
  const buysByClass = new Map<string, TradeRow[]>()
  buyMap.forEach(t => {
    if (!buysByClass.has(t.assetClass)) buysByClass.set(t.assetClass, [])
    buysByClass.get(t.assetClass)!.push(t)
  })

  // Sort classes: most underweight first (largest gap gets funded first)
  const sortedClasses = Array.from(buysByClass.entries()).sort(([acA], [acB]) => {
    const gapA = buysByClass.get(acA)!.reduce((s, t) => s + t.tradeAmount, 0)
    const gapB = buysByClass.get(acB)!.reduce((s, t) => s + t.tradeAmount, 0)
    return gapB - gapA
  })

  sortedClasses.forEach(([assetClass, classBuys]) => {
    if (availableCash <= 100) return

    // Class-level cap: don't buy above class target
    const classEquivValue = Array.from(globalEquivByTarget.entries())
      .filter(([ticker]) => {
        const m = accounts.flatMap(a => a.inModel).find(h => h.ticker === ticker)
        return m && inferDisplayAssetClass(m.msCategory, m.productClass, m.modelClass) === assetClass
      })
      .reduce((s, [, v]) => s + v, 0)
    // Only in-model holdings count as current (unassigned are sold or kept as equiv)
    const classInModelRaw = accounts.reduce((sum, acct) =>
      sum + acct.inModel.filter(h => inferDisplayAssetClass(h.msCategory, h.productClass, h.modelClass) === assetClass)
        .reduce((s, h) => s + h.currentValue, 0), 0)
    const classTarget = accounts.reduce((sum, acct) =>
      sum + acct.inModel.filter(h => inferDisplayAssetClass(h.msCategory, h.productClass, h.modelClass) === assetClass)
        .reduce((s, h) => s + h.targetValue, 0), 0)
    const classEffCurrent = classInModelRaw + classEquivValue
    const maxClassBuy = Math.max(0, classTarget - classEffCurrent)

    // Cap by both class target gap and available cash
    let classRemaining = Math.min(maxClassBuy, availableCash)

    classBuys.forEach(t => {
      if (classRemaining <= 100) return
      t.tradeAmount = Math.min(t.tradeAmount, classRemaining)
      if (t.tradeAmount > 100) {
        trades.push(t)
        classRemaining -= t.tradeAmount
        availableCash -= t.tradeAmount
      }
    })
  })

  const sells = trades.filter(t => t.tradeType === "sell")
  const totalTradeGL = sells.reduce((s, t) => s + t.realizedGL, 0)
  const estimatedTax = sells.reduce((s, t) => s + t.estimatedTax, 0)
  const ltGains = sells.filter(t => t.realizedGLLT > 0).reduce((s, t) => s + t.realizedGLLT, 0)
  const stGains = sells.filter(t => t.realizedGLST > 0).reduce((s, t) => s + t.realizedGLST, 0)
  const losses  = sells.filter(t => t.realizedGL < 0).reduce((s, t) => s + t.realizedGL, 0)

  const assetAllocation = buildAssetAllocation(accounts, trades, totalValue)
  const assetGroups = buildAssetGroups(accounts, trades, totalValue)
  const accountSummary = accounts.map(a => ({
    accountId: a.accountId, accountNumber: a.accountNumber, regType: a.regType,
    value: [...a.inModel, ...a.unassigned].reduce((s, h) => s + h.currentValue, 0),
  }))

  const totalSells = trades.filter(t => t.tradeType === "sell").reduce((s,t) => s + Math.abs(t.tradeAmount), 0)
  const totalBuys  = trades.filter(t => t.tradeType === "buy").reduce((s,t) => s + t.tradeAmount, 0)
  const netCashFromTrades = totalSells - totalBuys   // positive = net cash inflow
  const currentCash = accounts.reduce((s, a) => s + (a.cashValue || 0), 0)
  const postCash = currentCash + netCashFromTrades

  return {
    clientName, modelName, date, totalValue,
    totalTradeGL, estimatedTax,
    taxImpactPct: totalValue > 0 ? estimatedTax / totalValue : 0,
    ltGains, stGains, losses,
    totalRealizedGL: ltGains + stGains + losses,
    netCashFromTrades, currentCash,
    numTrades: trades.filter(t => t.tradeType !== "equivalent").length,
    assetAllocation, assetGroups, trades, accounts: accountSummary,
  }
}

function buildAssetAllocation(accounts: AccountData[], trades: TradeRow[], totalValue: number): AssetAllocationRow[] {
  // Build map: unassigned ticker → asset class from its equiv trade (uses target's modelClass)
  const equivAssetClassMap = new Map<string, string>()
  trades.filter(t => t.isEquivalent).forEach(t => {
    equivAssetClassMap.set(t.ticker, t.assetClass)
  })

  const getHoldingAssetClass = (h: { ticker: string; msCategory: string; productClass: string; modelClass: string; secSet: string }) => {
    // For unassigned holdings mapped as equivalents, use the target's asset class
    if (h.secSet === "Unassigned" && equivAssetClassMap.has(h.ticker)) {
      return equivAssetClassMap.get(h.ticker)!
    }
    return inferDisplayAssetClass(h.msCategory, h.productClass, h.modelClass)
  }

  const classSet = new Set<string>()
  accounts.forEach(acct => {
    ;[...acct.inModel, ...acct.unassigned].forEach(h => {
      classSet.add(getHoldingAssetClass(h))
    })
  })

  // Add Cash class
  classSet.add("Cash")

  return Array.from(classSet).map(ac => {
    const currentValue = ac === "Cash"
      ? accounts.reduce((sum, acct) => sum + (acct.cashValue || 0), 0)
      : accounts.reduce((sum, acct) =>
          sum + [...acct.inModel, ...acct.unassigned]
            .filter(h => getHoldingAssetClass(h) === ac)
            .reduce((s, h) => s + h.currentValue, 0), 0)

    // tradeAmount = net of buys and sells (equivalents have tradeAmount=0, so excluded)
    const tradeAmount = trades
      .filter(t => !t.isEquivalent && t.assetClass === ac)
      .reduce((s, t) => s + t.tradeAmount, 0)

    // Post trade = current + net trades
    // For Cash: post = currentCash + sells - buys (cash goes up on sells, down on buys)
    const netTradesForCash = ac === "Cash"
      ? trades.filter(t => t.tradeType === "sell").reduce((s, t) => s + Math.abs(t.tradeAmount), 0)
        - trades.filter(t => t.tradeType === "buy").reduce((s, t) => s + t.tradeAmount, 0)
      : 0
    const postTradeValue = ac === "Cash"
      ? Math.max(0, currentValue + netTradesForCash)
      : Math.max(0, currentValue + tradeAmount)
    const targetValue = ac === "Cash"
      ? accounts.reduce((sum, acct) => sum + (acct.cashTarget || 0), 0)
      : accounts.reduce((sum, acct) =>
          sum + acct.inModel.filter(h => inferDisplayAssetClass(h.msCategory, h.productClass, h.modelClass) === ac)
            .reduce((s, h) => s + h.targetValue, 0), 0)

    const targetPct = totalValue > 0 ? targetValue / totalValue : 0
    const postTradePct = totalValue > 0 ? postTradeValue / totalValue : 0
    const inTolerance = targetPct > 0
      ? Math.abs(postTradePct - targetPct) <= targetPct * TOLERANCE_BAND
      : postTradePct === 0

    return {
      assetClass: ac, currentValue,
      currentPct: totalValue > 0 ? currentValue / totalValue : 0,
      targetPct,
      postTradePct,
      tradeAmount,
      inTolerance,
    }
  }).filter(row => row.currentPct > 0 || row.tradeAmount !== 0 || row.targetPct > 0)
    .sort((a, b) => {
      const order = (ac: string) => {
        if (ac.includes("Equity") || ac.includes("Markets")) return 0
        if (ac === "Alternatives" || ac === "Commodities") return 1
        if (ac.includes("Fixed Income") || ac.includes("Investment Grade") || ac.includes("High Yield") || ac.includes("Bond")) return 2
        if (ac === "Cash" || ac === "Cash Equivalents") return 3
        return 1
      }
      const oa = order(a.assetClass), ob = order(b.assetClass)
      if (oa !== ob) return oa - ob
      return b.targetPct - a.targetPct
    })
}

function buildAssetGroups(accounts: AccountData[], trades: TradeRow[], totalValue: number): AssetClassGroup[] {
  const alloc = buildAssetAllocation(accounts, trades, totalValue)

  // Build equiv asset class map (same as in buildAssetAllocation)
  const equivAssetClassMap = new Map<string, string>()
  trades.filter(t => t.isEquivalent).forEach(t => {
    equivAssetClassMap.set(t.ticker, t.assetClass)
  })

  const getHoldingAssetClass = (h: { ticker: string; msCategory: string; productClass: string; modelClass: string; secSet: string }) => {
    if (h.secSet === "Unassigned" && equivAssetClassMap.has(h.ticker)) return equivAssetClassMap.get(h.ticker)!
    return inferDisplayAssetClass(h.msCategory, h.productClass, h.modelClass)
  }

  // Build equiv map: target ticker -> list of equiv holdings
  const equivsByTarget = new Map<string, EquivRow[]>()
  trades.filter(t => t.isEquivalent).forEach(t => {
    if (!equivsByTarget.has(t.mappedTicker)) equivsByTarget.set(t.mappedTicker, [])
    equivsByTarget.get(t.mappedTicker)!.push({
      ticker: t.ticker, securityName: t.securityName,
      currentValue: t.currentValue, equivalentOf: t.mappedTicker,
      unrealizedGL: t.unrealizedGL,
    })
  })

  return alloc.map(row => {
    const holdings: HoldingRow[] = []

    // In-model holdings — with equivalents nested under each
    accounts.forEach(acct => {
      acct.inModel
        .filter(h => inferDisplayAssetClass(h.msCategory, h.productClass, h.modelClass) === row.assetClass)
        .forEach(h => {
          const trade = trades.find(t => t.ticker === h.ticker && t.accountId === acct.accountId && t.isKeep)
          const equivs = equivsByTarget.get(h.ticker) || []
          const equivalentValue = equivs.reduce((s, e) => s + e.currentValue, 0)
          const effectiveCurrent = h.currentValue + equivalentValue
          const tradeAmt = trade?.tradeAmount || 0
          holdings.push({
            ticker: h.ticker, securityName: h.name,
            currentValue: h.currentValue,
            equivalentValue,
            effectiveCurrent,
            targetValue: h.targetValue,
            postTradeValue: effectiveCurrent + tradeAmt,
            tradeAmount: tradeAmt,
            isEquivalent: false,
            unrealizedGL: h.unrealizedGL,
            realizedGL: trade?.realizedGL || 0,
            estimatedTax: trade?.estimatedTax || 0,
            equivalents: equivs,
          })
        })
    })

    // Also include any buy trades for securities not yet in model
    trades
      .filter(t => t.tradeType === "buy" && !t.isKeep && t.assetClass === row.assetClass)
      .forEach(t => {
        // Skip if already in holdings
        if (holdings.find(h => h.ticker === t.ticker)) return
        const equivs = equivsByTarget.get(t.ticker) || []
        const equivalentValue = equivs.reduce((s, e) => s + e.currentValue, 0)
        const effectiveCurrent = t.currentValue + equivalentValue
        holdings.push({
          ticker: t.ticker, securityName: t.securityName,
          currentValue: t.currentValue,
          equivalentValue,
          effectiveCurrent,
          targetValue: t.targetValue,
          postTradeValue: effectiveCurrent + t.tradeAmount,
          tradeAmount: t.tradeAmount,
          isEquivalent: false,
          unrealizedGL: 0,
          realizedGL: 0,
          estimatedTax: 0,
          equivalents: equivs,
        })
      })

    // Sells (unassigned positions being sold - show at class level)
    trades
      .filter(t => t.tradeType === "sell" && !t.isKeep && t.assetClass === row.assetClass)
      .forEach(t => {
        holdings.push({
          ticker: t.ticker, securityName: t.securityName,
          currentValue: t.currentValue, equivalentValue: 0, effectiveCurrent: t.currentValue,
          targetValue: 0,
          postTradeValue: 0,
          tradeAmount: t.tradeAmount,
          isEquivalent: false,
          unrealizedGL: t.unrealizedGL,
          realizedGL: t.realizedGL,
          estimatedTax: t.estimatedTax,
          equivalents: [],
        })
      })

    return {
      assetClass: row.assetClass,
      currentValue: row.currentValue,
      targetValue: totalValue * row.targetPct,
      postTradeValue: totalValue * row.postTradePct,
      totalValue,
      currentPct: row.currentPct,
      targetPct: row.targetPct,
      postTradePct: row.postTradePct,
      tradeAmount: row.tradeAmount,
      inTolerance: row.inTolerance,
      holdings,
    }
  })
}
