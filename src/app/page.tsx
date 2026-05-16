// ─── Models ───────────────────────────────────────────────────────────────────
export const MODELS = [
  { id: "stp",                         label: "Savvy Total Portfolio" },
  { id: "stp-tax-aware",               label: "Savvy Total Portfolio - Tax Aware" },
  { id: "savvy-strategic",             label: "Savvy Strategic Model" },
  { id: "savvy-strategic-tax-aware",   label: "Savvy Strategic Model - Tax Aware" },
  { id: "blackrock-target-allocation", label: "BlackRock Target Allocation ETF Model" },
  { id: "vanguard-crsp",               label: "Vanguard CRSP Series" },
] as const

export type ModelId = typeof MODELS[number]["id"]

// ─── Morningstar Style Box ─────────────────────────────────────────────────────
export type MsStyle =
  | "Large Value" | "Large Blend" | "Large Growth"
  | "Mid Value"   | "Mid Blend"   | "Mid Growth"
  | "Small Value" | "Small Blend" | "Small Growth"
  | "Foreign Large Value" | "Foreign Large Blend" | "Foreign Large Growth"
  | "Diversified Emerging Mkts" | "World Stock"
  | "Intermediate Core Bond" | "Short-Term Bond" | "Long-Term Bond"
  | "Inflation-Protected Bond" | "High Yield Bond" | "World Bond"
  | "Real Estate" | "Commodities" | "Allocation"
  | "Unknown"

// ─── Data Shapes ──────────────────────────────────────────────────────────────
export interface MorningstarRow {
  ticker: string
  name: string
  msStyle: MsStyle
  assetClass: string
  region: string
  factors: string[]
  splitRegions?: { region: string; weight: number }[]
}

export interface ModelUniverseRow {
  modelId: ModelId
  ticker: string
  name: string
  role: string
}

// ─── Mapping Output ────────────────────────────────────────────────────────────
export interface MappedSecurity {
  inputTicker: string
  mappings: {
    ticker: string
    name: string
    msStyle: MsStyle
    assetClass: string
    region: string
    weight?: number
    note?: string
  }[]
  status: "mapped" | "split" | "no-match" | "not-in-model"
}
