import type { AccountData, ImportHolding, ProcessedHolding, ImportMatch } from "./importParser"

export const TAX_RATE_LT = 0.238
export const TAX_RATE_ST = 0.408

export interface TradeRow {
  id: string
  accountId: string
  accountNumber: string
  ticker: string
  securityName: string
  tradeType: "buy" | "sell"
  tradeAmount: number
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
  userOverride: boolean
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
  assetAllocation: AssetAllocationRow[]
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
}

function inferDisplayAssetClass(msCategory: string, productClass: string, modelClass: string): string {
  // If we have a Model Class, strip the model name prefix to get just the asset class
  // e.g. "Savvy Strategic 60/40 US Fixed Income" -> "US Fixed Income"
  if (modelClass && modelClass !== "Unassigned" && modelClass !== "Cash" && modelClass !== "N/A") {
    // Common asset class suffixes to extract
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
    // Fallback: strip known model name patterns (anything before last 2-3 words)
    const parts = modelClass.trim().split(/\s+/)
    if (parts.length > 2) {
      // Try last 2 words, then last 3 words
      const last2 = parts.slice(-2).join(" ")
      const last3 = parts.slice(-3).join(" ")
      // If last word is a known asset class word, use last 2-3
      const assetWords = ["equity", "income", "bonds", "markets", "cap", "alternatives", "commodities"]
      if (assetWords.some(w => last2.toLowerCase().includes(w))) return last3
    }
  }

  // Fallback to category inference
  const cat = (msCategory + " " + productClass).toLowerCase()
  if (cat.includes("emerging")) return "Emerging Markets"
  if (cat.includes("international") || cat.includes("foreign") || cat.includes("eafe")) return "International Equity"
  if (cat.includes("high yield")) return "High Yield Corporate Bonds"
  if (cat.includes("bond") || cat.includes("fixed") || cat.includes("muni") || cat.includes("treasury") ||
      cat.includes("securitized") || cat.includes("mortgage") || cat.includes("taxable bonds") || cat.includes("government")) return "US Fixed Income"
  if (cat.includes("commodity") || cat.includes("gold")) return "Commodities"
  if (cat.includes("alternative")) return "Alternatives"
  if (cat.includes("sector") || cat.includes("technology") || cat.includes("industrials")) return "Sector Equity"
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

  const trades: TradeRow[] = []

  processedAccounts.forEach(({ accountId, accountNumber, processed }) => {
    const account = accounts.find(a => a.accountId === accountId)
    if (!account) return

    processed.forEach(p => {
      const h = p.holding
      const isSellLoss = p.action === "sell-loss"
      const isSellGain = p.action === "sell-gain"
      const isMap = p.action === "map"

      // Determine realized G/L
      // For mapped positions: still selling the full position, realizing the gain
      // The full current value gets sold and equivalent gets bought
      const isSelling = isSellLoss || isSellGain || isMap
      const realizedGL = isSelling ? h.unrealizedGL : 0
      const realizedGLST = isSelling ? h.unrealizedGLST : 0
      const realizedGLLT = isSelling ? h.unrealizedGLLT : 0
      const estimatedTax = realizedGL > 0
        ? (realizedGLLT > 0 ? realizedGLLT * TAX_RATE_LT : 0) + (realizedGLST > 0 ? realizedGLST * TAX_RATE_ST : 0)
        : 0
      const assetClass = inferDisplayAssetClass(h.msCategory, h.productClass, h.modelClass)

      // Sell row
      trades.push({
        id: `${accountId}-${h.ticker}-sell`,
        accountId, accountNumber,
        ticker: h.ticker, securityName: h.name,
        tradeType: "sell", tradeAmount: -h.currentValue,
        currentValue: h.currentValue, targetValue: 0,
        unrealizedGL: h.unrealizedGL, unrealizedGLST: h.unrealizedGLST, unrealizedGLLT: h.unrealizedGLLT,
        isLongTerm: h.isLongTerm,
        realizedGL, realizedGLST, realizedGLLT, estimatedTax,
        msCategory: h.msCategory, productClass: h.productClass, assetClass,
        mappedTicker: p.matches[0]?.ticker || "",
        mappedName: p.matches[0]?.name || "",
        isSell: true, isKeep: false, userOverride: false,
      })

      // Buy rows
      if (isMap || isSellGain) {
        p.matches.forEach(m => {
          const buyAmount = h.currentValue * (m.weight ?? 1)
          trades.push({
            id: `${accountId}-${m.ticker}-buy-${h.ticker}`,
            accountId, accountNumber,
            ticker: m.ticker, securityName: m.name,
            tradeType: "buy", tradeAmount: buyAmount,
            currentValue: m.currentValue, targetValue: m.targetValue,
            unrealizedGL: 0, unrealizedGLST: 0, unrealizedGLLT: 0, isLongTerm: true,
            realizedGL: 0, realizedGLST: 0, realizedGLLT: 0, estimatedTax: 0,
            msCategory: m.msCategory, productClass: "", assetClass: inferDisplayAssetClass(m.msCategory, "", ""),
            mappedTicker: m.ticker, mappedName: m.name,
            isSell: false, isKeep: false, userOverride: false,
          })
        })
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
        trades.push({
          id: `${accountId}-${h.ticker}-rebal`,
          accountId, accountNumber,
          ticker: h.ticker, securityName: h.name,
          tradeType: gap > 0 ? "buy" : "sell", tradeAmount: gap,
          currentValue: h.currentValue, targetValue: h.targetValue,
          unrealizedGL: h.unrealizedGL, unrealizedGLST: h.unrealizedGLST, unrealizedGLLT: h.unrealizedGLLT,
          isLongTerm: h.isLongTerm, realizedGL, realizedGLST, realizedGLLT, estimatedTax,
          msCategory: h.msCategory, productClass: h.productClass, assetClass,
          mappedTicker: h.ticker, mappedName: h.name,
          isSell: gap < 0, isKeep: true, userOverride: false,
        })
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
  const accountSummary = accounts.map(a => ({
    accountId: a.accountId, accountNumber: a.accountNumber, regType: a.regType,
    value: [...a.inModel, ...a.unassigned].reduce((s, h) => s + h.currentValue, 0),
  }))

  return {
    clientName, modelName, date, totalValue,
    totalTradeGL, estimatedTax, taxImpactPct: totalValue > 0 ? estimatedTax / totalValue : 0,
    ltGains, stGains, losses,
    numTrades: trades.length,
    assetAllocation, trades, accounts: accountSummary,
  }
}

function buildAssetAllocation(accounts: AccountData[], trades: TradeRow[], totalValue: number): AssetAllocationRow[] {
  const classes = ["US Equity", "International Equity", "US Fixed Income", "Sector Equity", "Alternatives"]
  return classes.map(ac => {
    const currentValue = accounts.reduce((sum, acct) =>
      sum + [...acct.inModel, ...acct.unassigned]
        .filter(h => inferDisplayAssetClass(h.msCategory, h.productClass, h.modelClass) === ac)
        .reduce((s, h) => s + h.currentValue, 0), 0)
    const tradeAmount = trades.filter(t => t.assetClass === ac).reduce((s, t) => s + t.tradeAmount, 0)
    const postTradeValue = Math.max(0, currentValue + tradeAmount)
    // Use target from model holdings
    const targetValue = accounts.reduce((sum, acct) =>
      sum + acct.inModel.filter(h => inferDisplayAssetClass(h.msCategory, h.productClass, h.modelClass) === ac)
        .reduce((s, h) => s + h.targetValue, 0), 0)
    return {
      assetClass: ac, currentValue,
      currentPct: totalValue > 0 ? currentValue / totalValue : 0,
      targetPct: totalValue > 0 ? targetValue / totalValue : 0,
      postTradePct: totalValue > 0 ? postTradeValue / totalValue : 0,
      tradeAmount,
    }
  }).filter(row => row.currentPct > 0 || row.tradeAmount !== 0 || row.targetPct > 0)
}
