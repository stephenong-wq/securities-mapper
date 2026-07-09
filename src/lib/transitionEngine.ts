import type { AccountData, ImportHolding, ProcessedHolding, ImportMatch } from "./importParser"

// ─── Tax rates ────────────────────────────────────────────────────────────────
export const TAX_RATE_LT = 0.20  // Long-term capital gains
export const TAX_RATE_ST = 0.37  // Short-term capital gains

// ─── Types ────────────────────────────────────────────────────────────────────
export interface TradeRow {
  id: string                    // unique id for editing
  accountId: string
  accountNumber: string
  ticker: string
  securityName: string
  tradeType: "buy" | "sell"
  tradeAmount: number           // $ amount
  currentValue: number
  targetValue: number
  unrealizedGL: number
  isLongTerm: boolean
  realizedGL: number            // only for sells
  estimatedTax: number          // only for sells with gains
  msCategory: string
  assetClass: string
  // Editable fields
  mappedTicker: string          // what we're buying (for sells that map)
  mappedName: string
  isSell: boolean
  isKeep: boolean               // already in model, just rebalancing
  userOverride: boolean         // user changed the mapping
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
  currentPct: number
  targetPct: number
  postTradePct: number
  tradeAmount: number
}

// ─── Build transition summary ─────────────────────────────────────────────────
export function buildTransition(
  accounts: AccountData[],
  processedAccounts: { accountId: string; accountNumber: string; modelName: string; processed: ProcessedHolding[] }[],
  gainsBudget: number | null,
  clientName: string
): TransitionSummary {
  const modelName = processedAccounts[0]?.modelName || "Unknown Model"
  const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })

  // Total portfolio value
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

      // Sell row
      const realizedGL = (isSellLoss || isSellGain) ? h.unrealizedGL : 0
      const isLongTerm = h.isLongTerm ?? true
      const estimatedTax = realizedGL > 0
        ? realizedGL * (isLongTerm ? TAX_RATE_LT : TAX_RATE_ST)
        : 0

      trades.push({
        id: `${accountId}-${h.ticker}-sell`,
        accountId,
        accountNumber,
        ticker: h.ticker,
        securityName: h.name,
        tradeType: "sell",
        tradeAmount: -(h.currentValue),
        currentValue: h.currentValue,
        targetValue: 0,
        unrealizedGL: h.unrealizedGL,
        isLongTerm,
        realizedGL,
        estimatedTax,
        msCategory: h.msCategory,
        assetClass: inferAssetClass(h.msCategory, h.productClass),
        mappedTicker: p.matches[0]?.ticker || "",
        mappedName: p.matches[0]?.name || "",
        isSell: true,
        isKeep: false,
        userOverride: false,
      })

      // Buy rows for mapped equivalents
      if (isMap || isSellGain) {
        p.matches.forEach(m => {
          trades.push({
            id: `${accountId}-${m.ticker}-buy-${h.ticker}`,
            accountId,
            accountNumber,
            ticker: m.ticker,
            securityName: m.name,
            tradeType: "buy",
            tradeAmount: h.currentValue * (m.weight ?? 1),
            currentValue: m.currentValue,
            targetValue: m.targetValue,
            unrealizedGL: 0,
            isLongTerm: true,
            realizedGL: 0,
            estimatedTax: 0,
            msCategory: m.msCategory,
            assetClass: inferAssetClass(m.msCategory, ""),
            mappedTicker: m.ticker,
            mappedName: m.name,
            isSell: false,
            isKeep: false,
            userOverride: false,
          })
        })
      }
    })

    // In-model holdings that need rebalancing (target > current)
    account.inModel.forEach(h => {
      const gap = h.targetValue - h.currentValue
      if (Math.abs(gap) > 100) {
        trades.push({
          id: `${accountId}-${h.ticker}-rebal`,
          accountId,
          accountNumber,
          ticker: h.ticker,
          securityName: h.name,
          tradeType: gap > 0 ? "buy" : "sell",
          tradeAmount: gap,
          currentValue: h.currentValue,
          targetValue: h.targetValue,
          unrealizedGL: h.unrealizedGL,
          isLongTerm: h.isLongTerm ?? true,
          realizedGL: gap < 0 ? Math.max(0, h.unrealizedGL * Math.abs(gap) / h.currentValue) : 0,
          estimatedTax: 0,
          msCategory: h.msCategory,
          assetClass: inferAssetClass(h.msCategory, h.productClass),
          mappedTicker: h.ticker,
          mappedName: h.name,
          isSell: gap < 0,
          isKeep: true,
          userOverride: false,
        })
      }
    })
  })

  // Totals
  const sells = trades.filter(t => t.tradeType === "sell")
  const totalTradeGL = sells.reduce((s, t) => s + t.realizedGL, 0)
  const estimatedTax = sells.reduce((s, t) => s + t.estimatedTax, 0)
  const ltGains = sells.filter(t => t.realizedGL > 0 && t.isLongTerm).reduce((s, t) => s + t.realizedGL, 0)
  const stGains = sells.filter(t => t.realizedGL > 0 && !t.isLongTerm).reduce((s, t) => s + t.realizedGL, 0)
  const losses = sells.filter(t => t.realizedGL < 0).reduce((s, t) => s + t.realizedGL, 0)

  // Asset allocation
  const assetAllocation = buildAssetAllocation(accounts, trades, totalValue)

  // Account summary
  const accountSummary = accounts.map(a => ({
    accountId: a.accountId,
    accountNumber: a.accountNumber,
    regType: a.regType || "",
    value: [...a.inModel, ...a.unassigned].reduce((s, h) => s + h.currentValue, 0),
  }))

  return {
    clientName,
    modelName,
    date,
    totalValue,
    totalTradeGL,
    estimatedTax,
    taxImpactPct: totalValue > 0 ? estimatedTax / totalValue : 0,
    ltGains,
    stGains,
    losses,
    numTrades: trades.length,
    assetAllocation,
    trades,
    accounts: accountSummary,
  }
}

function inferAssetClass(msCategory: string, productClass: string): string {
  const cat = (msCategory + " " + productClass).toLowerCase()
  if (cat.includes("emerging")) return "International Equity"
  if (cat.includes("foreign") || cat.includes("international") || cat.includes("eafe")) return "International Equity"
  if (cat.includes("bond") || cat.includes("fixed") || cat.includes("muni") || cat.includes("treasury")) return "US Fixed Income"
  if (cat.includes("real estate") || cat.includes("commodity") || cat.includes("gold") || cat.includes("alternative")) return "Alternatives"
  if (cat.includes("sector") || cat.includes("technology") || cat.includes("health") || cat.includes("energy")) return "Sector Equity"
  return "US Equity"
}

function buildAssetAllocation(
  accounts: AccountData[],
  trades: TradeRow[],
  totalValue: number
): AssetAllocationRow[] {
  const classes = ["US Equity", "International Equity", "US Fixed Income", "Sector Equity", "Alternatives", "Cash"]

  return classes.map(ac => {
    const currentValue = accounts.reduce((sum, acct) =>
      sum + [...acct.inModel, ...acct.unassigned]
        .filter(h => inferAssetClass(h.msCategory, h.productClass) === ac)
        .reduce((s, h) => s + h.currentValue, 0), 0)

    const tradeAmount = trades
      .filter(t => t.assetClass === ac)
      .reduce((s, t) => s + t.tradeAmount, 0)

    const postTradeValue = currentValue + tradeAmount
    const targetValue = postTradeValue // simplified

    return {
      assetClass: ac,
      currentPct: totalValue > 0 ? currentValue / totalValue : 0,
      targetPct: totalValue > 0 ? targetValue / totalValue : 0,
      postTradePct: totalValue > 0 ? postTradeValue / totalValue : 0,
      tradeAmount,
    }
  }).filter(row => row.currentPct > 0 || row.tradeAmount !== 0)
}
