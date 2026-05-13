// ─── Models ───────────────────────────────────────────────────────────────────
export const MODELS = [
  { id: "core-allocation",     label: "Core Allocation",      description: "Broad market exposure using low-cost index funds" },
  { id: "factor-tilt",         label: "Factor Tilt",          description: "Value, momentum, quality, and size factor exposure" },
  { id: "esg-responsible",     label: "ESG / Responsible",    description: "Screens for environmental, social, and governance criteria" },
  { id: "active-blend",        label: "Active Blend",         description: "Mix of active and passive strategies by asset class" },
  { id: "institutional-plus",  label: "Institutional Plus",   description: "Institutional share classes and alternatives access" },
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
  status: "mapped" | "split" | "no-match" | "not-in-model"
}
