// ─── Models ───────────────────────────────────────────────────────────────────
export const MODELS = [
  { id: "stp",           label: "Savvy Total Portfolio",            description: "Savvy Total Portfolio core model" },
  { id: "stp-tax-aware", label: "Savvy Total Portfolio - Tax Aware", description: "Savvy Total Portfolio tax-aware model" },
  { id: "savvy-strategic",             label: "Savvy Strategic Model",                 description: "Savvy Strategic core model" },
  { id: "savvy-strategic-tax-aware",   label: "Savvy Strategic Model - Tax Aware",     description: "Savvy Strategic tax-aware model" },
  { id: "blackrock-target-allocation", label: "BlackRock Target Allocation ETF Model", description: "BlackRock target allocation ETF model" },
  { id: "vanguard-crsp",               label: "Vanguard CRSP Series",                  description: "Vanguard CRSP index series" },
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
  assetClass: string       // e.g. "US Equity", "Intl Equity", "Fixed Income"
  region: string           // e.g. "US", "Developed ex-US", "Emerging", "Global"
  factors: string[]        // e.g. ["Value", "Low Vol"]
  splitRegions?: { region: string; weight: number }[]  // for blended funds like IXUS
}
 
export interface ModelUniverseRow {
  modelId: ModelId
  ticker: string
  name: string
  role: string             // e.g. "US Large Cap Core", "Emerging Markets"
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
    weight?: number        // set when input splits into multiple (e.g. 0.7 / 0.3)
    note?: string
  }[]
  status: "mapped" | "split" | "no-match" | "not-in-model" | "excluded"
}
 
