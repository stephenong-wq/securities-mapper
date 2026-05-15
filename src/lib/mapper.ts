import type { MorningstarRow, ModelUniverseRow, ModelId, MappedSecurity, MsStyle } from "./types"

export function mapSecurities(
  inputTickers: string[],
  modelId: ModelId,
  msData: MorningstarRow[],
  modelUniverse: ModelUniverseRow[]
): MappedSecurity[] {
  const msMap = new Map<string, MorningstarRow>()
  msData.forEach(r => msMap.set(r.ticker.toUpperCase(), r))
  const universeForModel = modelUniverse.filter(r => r.modelId === modelId)
  const universeTickers = new Set(universeForModel.map(r => r.ticker.toUpperCase()))

  return inputTickers.map(raw => {
    const ticker = raw.toUpperCase().trim()
    const inputMs = msMap.get(ticker)

    if (universeTickers.has(ticker)) {
      const ms = inputMs ?? { name: ticker, msStyle: "Unknown" as MsStyle, assetClass: "-", region: "-" }
      return { inputTicker: ticker, status: "mapped", mappings: [{ ticker, name: ms.name, msStyle: ms.msStyle, assetClass: ms.assetClass, region: ms.region }] } satisfies MappedSecurity
    }

    if (!inputMs) return { inputTicker: ticker, status: "no-match", mappings: [] } satisfies MappedSecurity

    if (inputMs.splitRegions && inputMs.splitRegions.length > 0) {
      const splitMappings = inputMs.splitRegions.flatMap(split => {
        const candidates = findCandidates(msMap, universeForModel, inputMs.assetClass, split.region)
        return candidates.map(c => ({ ticker: c.ticker, name: c.name, msStyle: c.msStyle, assetClass: c.assetClass, region: c.region, weight: split.weight, note: `${Math.round(split.weight * 100)}% ${split.region} exposure` }))
      })
      if (splitMappings.length > 0) return { inputTicker: ticker, status: "split", mappings: splitMappings } satisfies MappedSecurity
    }

    const candidates = findCandidates(msMap, universeForModel, inputMs.assetClass, inputMs.region)
    if (candidates.length === 0) return { inputTicker: ticker, status: "not-in-model", mappings: [] } satisfies MappedSecurity

    const ranked = candidates.sort((a, b) => styleMatchScore(inputMs.msStyle, b.msStyle) - styleMatchScore(inputMs.msStyle, a.msStyle))
    const best = ranked[0]
    return { inputTicker: ticker, status: "mapped", mappings: [{ ticker: best.ticker, name: best.name, msStyle: best.msStyle, assetClass: best.assetClass, region: best.region, note: candidates.length > 1 ? `Also consider: ${ranked.slice(1).map(r => r.ticker).join(", ")}` : undefined }] } satisfies MappedSecurity
  })
}

function findCandidates(msMap: Map<string, MorningstarRow>, universeRows: ModelUniverseRow[], assetClass: string, region: string): MorningstarRow[] {
  return universeRows.map(r => msMap.get(r.ticker.toUpperCase())).filter((ms): ms is MorningstarRow => {
    if (!ms) return false
    const classMatch = ms.assetClass === assetClass
    const regionMatch = ms.region === region ||
      (region === "Global ex-US" && (ms.region === "Developed ex-US" || ms.region === "Emerging")) ||
      (ms.region === "Global ex-US" && (region === "Developed ex-US" || region === "Emerging"))
    return classMatch && regionMatch
  })
}

function styleMatchScore(input: MsStyle, candidate: MsStyle): number {
  if (input === candidate) return 3
  const ip = input.split(" "), cp = candidate.split(" ")
  if (ip[0] === cp[0]) return 2
  if (ip[ip.length-1] === cp[cp.length-1]) return 1
  return 0
}

function inferRegion(msCategory: string, assetClass: string): string {
  const cat = msCategory.toLowerCase(), ac = assetClass.toLowerCase()
  if (cat.includes("emerging")) return "Emerging"
  if (cat.includes("foreign") || cat.includes("europe") || cat.includes("eafe") || cat.includes("international") || ac.includes("global equity")) return "Developed ex-US"
  if (ac.includes("global") || cat.includes("global")) return "Global"
  if (ac.includes("commodities")) return "Global"
  return "US"
}

function inferAssetClass(msCategory: string, rawAssetClass: string): string {
  const cat = msCategory.toLowerCase(), ac = rawAssetClass.toLowerCase()
  if (ac.includes("fixed income") || cat.includes("bond") || cat.includes("muni") || cat.includes("securitized") || cat.includes("ultrashort") || cat.includes("loan")) return "Fixed Income"
  if (ac.includes("commodities") || cat.includes("commodit") || cat.includes("precious metals") || cat.includes("natural resources")) return "Real Assets"
  if (cat.includes("real estate")) return "Real Assets"
  if (ac.includes("global emerging markets equity") || cat.includes("diversified emerging")) return "Intl Equity"
  if (ac.includes("global equity") || cat.includes("foreign") || cat.includes("europe") || cat.includes("india") || cat.includes("china")) return "Intl Equity"
  if (ac.includes("us equity") || cat.includes("large blend") || cat.includes("large value") || cat.includes("large growth") || cat.includes("mid-cap") || cat.includes("small")) return "US Equity"
  if (ac.includes("allocation") || cat.includes("allocation")) return "Allocation"
  if (ac.includes("alternative") || cat.includes("market neutral") || cat.includes("long/short") || cat.includes("systematic trend")) return "Alternative"
  return "Other"
}

export function parseMorningstarExcel(rows: Record<string, string>[]): MorningstarRow[] {
  return rows.map(row => {
    const get = (...keys: string[]) => {
      for (const k of keys) {
        const found = Object.keys(row).find(rk => rk.toLowerCase().replace(/[\s_-]/g,"") === k.toLowerCase().replace(/[\s_-]/g,""))
        if (found && row[found]) return row[found].trim()
      }
      return ""
    }
    const ticker     = get("symbol","ticker").toUpperCase()
    const msCategory = get("morningstar category","morningstarcategory","category")
    const rawAC      = get("asset class","assetclass")
    const name       = get("name","fund name","fundname") || ticker
    const factors    = get("factors","factor").split(",").map(s => s.trim()).filter(Boolean)
    const splitStr   = get("splitregions","regions","split regions")
    let splitRegions: { region: string; weight: number }[] | undefined
    if (splitStr) {
      splitRegions = splitStr.split(",").map(s => {
        const [region, weight] = s.split(":")
        return { region: region?.trim() || "", weight: parseFloat(weight) || 0 }
      }).filter(r => r.region)
    }
    return { ticker, name, msStyle: (msCategory || "Unknown") as MsStyle, assetClass: inferAssetClass(msCategory, rawAC), region: inferRegion(msCategory, rawAC), factors, ...(splitRegions ? { splitRegions } : {}) }
  }).filter(r => r.ticker)
}

export function parseModelUniverseExcel(rows: Record<string, string>[]): ModelUniverseRow[] {
  return rows.map(row => {
    const get = (...keys: string[]) => {
      for (const k of keys) {
        const found = Object.keys(row).find(rk => rk.toLowerCase().replace(/\s/g,"") === k.toLowerCase().replace(/\s/g,""))
        if (found && row[found]) return row[found].trim()
      }
      return ""
    }
    return { modelId: get("modelid","model") as ModelId, ticker: get("ticker","symbol").toUpperCase(), name: get("name","fundname"), role: get("role","description") }
  }).filter(r => r.modelId && r.ticker)
}
