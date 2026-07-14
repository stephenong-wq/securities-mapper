import type { AccountData, ImportHolding, ProcessedHolding, ImportMatch } from "./importParser"

export const TAX_RATE_LT = 0.238
export const TAX_RATE_ST = 0.408
export const TOLERANCE_BAND = 0.05  // ±5%

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

export interface HoldingRow {
  ticker: string
  securityName: string
  currentValue: number
  targetValue: number
  postTradeValue: number
  tradeAmount: number
  isEquivalent: boolean
  equivalentOf?: string
  unrealizedGL: number
  realizedGL: number
  estimatedTax: number
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
        // Mapped equivalent — no actual trade, just track as equivalent
        rawTrades.push({
          id: `${accountId}-${h.ticker}-equiv`,
          accountId, accountNumber,
          ticker: h.ticker, securityName: h.name,
          tradeType: "equivalent", tradeAmount: 0,
          currentValue: h.currentValue, targetValue: 0,
          unrealizedGL: h.unrealizedGL, unrealizedGLST: h.unrealizedGLST, unrealizedGLLT: h.unrealizedGLLT,
          isLongTerm: h.isLongTerm,
          realizedGL: 0, realizedGLST: 0, realizedGLLT: 0, estimatedTax: 0,
          msCategory: h.msCategory, productClass: h.productClass, assetClass,
          mappedTicker: p.matches[0]?.ticker || "", mappedName: p.matches[0]?.name || "",
          isSell: false, isKeep: false, isEquivalent: true, mapScore: p.mapScore, userOverride: false,
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
        if (isSellGain && p.matches.length > 0) {
          p.matches.forEach(m => {
            rawTrades.push({
              id: `${accountId}-${m.ticker}-buy-${h.ticker}`,
              accountId, accountNumber,
              ticker: m.ticker, securityName: m.name,
              tradeType: "buy", tradeAmount: h.currentValue * (m.weight ?? 1),
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

    // In-model rebalancing
    account.inModel.forEach(h => {
      const gap = h.targetValue - h.currentValue
      if (Math.abs(gap) > 100) {
        const assetClass = inferDisplayAssetClass(h.msCategory, h.productClass, h.modelClass)
        const partialRatio = gap < 0 && h.currentValue > 0 ? Math.abs(gap) / h.currentValue : 0
        const realizedGLLT = gap < 0 ? h.unrealizedGLLT * partialRatio : 0
        const realizedGLST = gap < 0 ? h.unrealizedGLST * partialRatio : 0
        const realizedGL = realizedGLLT + realizedGLST
        const estimatedTax = realizedGL > 0
          ? (realizedGLLT > 0 ? realizedGLLT * TAX_RATE_LT : 0) + (realizedGLST > 0 ? realizedGLST * TAX_RATE_ST : 0)
          : 0
        rawTrades.push({
          id: `${accountId}-${h.ticker}-rebal`,
          accountId, accountNumber,
          ticker: h.ticker, securityName: h.name,
          tradeType: gap > 0 ? "buy" : "sell", tradeAmount: gap,
          currentValue: h.currentValue, targetValue: h.targetValue,
          unrealizedGL: h.unrealizedGL, unrealizedGLST: h.unrealizedGLST, unrealizedGLLT: h.unrealizedGLLT,
          isLongTerm: h.isLongTerm, realizedGL, realizedGLST, realizedGLLT, estimatedTax,
          msCategory: h.msCategory, productClass: h.productClass, assetClass,
          mappedTicker: h.ticker, mappedName: h.name,
          isSell: gap < 0, isKeep: true, isEquivalent: false, mapScore: 10, userOverride: false,
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
  buyMap.forEach(t => trades.push(t))

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

  return {
    clientName, modelName, date, totalValue,
    totalTradeGL, estimatedTax,
    taxImpactPct: totalValue > 0 ? estimatedTax / totalValue : 0,
    ltGains, stGains, losses,
    totalRealizedGL: ltGains + stGains + losses,
    numTrades: trades.filter(t => t.tradeType !== "equivalent").length,
    assetAllocation, assetGroups, trades, accounts: accountSummary,
  }
}

function buildAssetAllocation(accounts: AccountData[], trades: TradeRow[], totalValue: number): AssetAllocationRow[] {
  const classSet = new Set<string>()
  accounts.forEach(acct => {
    ;[...acct.inModel, ...acct.unassigned].forEach(h => {
      classSet.add(inferDisplayAssetClass(h.msCategory, h.productClass, h.modelClass))
    })
  })

  return Array.from(classSet).map(ac => {
    const currentValue = accounts.reduce((sum, acct) =>
      sum + [...acct.inModel, ...acct.unassigned]
        .filter(h => inferDisplayAssetClass(h.msCategory, h.productClass, h.modelClass) === ac)
        .reduce((s, h) => s + h.currentValue, 0), 0)

    // tradeAmount = net of buys and sells (equivalents have tradeAmount=0, so excluded)
    const tradeAmount = trades
      .filter(t => !t.isEquivalent && t.assetClass === ac)
      .reduce((s, t) => s + t.tradeAmount, 0)

    // Post trade = current + net trades (equivalents already counted in currentValue)
    const postTradeValue = Math.max(0, currentValue + tradeAmount)
    const targetValue = accounts.reduce((sum, acct) =>
      sum + acct.inModel.filter(h => inferDisplayAssetClass(h.msCategory, h.productClass, h.modelClass) === ac)
        .reduce((s, h) => s + h.targetValue, 0), 0)

    const targetPct = totalValue > 0 ? targetValue / totalValue : 0
    const postTradePct = totalValue > 0 ? postTradeValue / totalValue : 0
    const inTolerance = Math.abs(postTradePct - targetPct) <= TOLERANCE_BAND

    return {
      assetClass: ac, currentValue,
      currentPct: totalValue > 0 ? currentValue / totalValue : 0,
      targetPct,
      postTradePct,
      tradeAmount,
      inTolerance,
    }
  }).filter(row => row.currentPct > 0 || row.tradeAmount !== 0 || row.targetPct > 0)
    .sort((a, b) => b.targetPct - a.targetPct)
}

function buildAssetGroups(accounts: AccountData[], trades: TradeRow[], totalValue: number): AssetClassGroup[] {
  const alloc = buildAssetAllocation(accounts, trades, totalValue)
  return alloc.map(row => {
    const holdings: HoldingRow[] = []

    // In-model holdings
    accounts.forEach(acct => {
      acct.inModel
        .filter(h => inferDisplayAssetClass(h.msCategory, h.productClass, h.modelClass) === row.assetClass)
        .forEach(h => {
          const trade = trades.find(t => t.ticker === h.ticker && t.accountId === acct.accountId && t.isKeep)
          holdings.push({
            ticker: h.ticker, securityName: h.name,
            currentValue: h.currentValue, targetValue: h.targetValue,
            postTradeValue: h.currentValue + (trade?.tradeAmount || 0),
            tradeAmount: trade?.tradeAmount || 0,
            isEquivalent: false,
            unrealizedGL: h.unrealizedGL,
            realizedGL: trade?.realizedGL || 0,
            estimatedTax: trade?.estimatedTax || 0,
          })
        })
    })

    // Equivalent holdings
    trades
      .filter(t => t.isEquivalent && t.assetClass === row.assetClass)
      .forEach(t => {
        holdings.push({
          ticker: t.ticker, securityName: t.securityName,
          currentValue: t.currentValue, targetValue: 0,
          postTradeValue: t.currentValue,
          tradeAmount: 0,
          isEquivalent: true,
          equivalentOf: t.mappedTicker,
          unrealizedGL: t.unrealizedGL,
          realizedGL: 0, estimatedTax: 0,
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
