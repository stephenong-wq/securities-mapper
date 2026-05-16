import type { MorningstarRow, ModelUniverseRow, ModelId, MappedSecurity, MsStyle } from "./types"

// ─── Index/benchmark fingerprinting ───────────────────────────────────────────
function indexFingerprint(name: string): string[] {
  const n = name.toLowerCase()
    .replace(/ishares|vanguard|schwab|spdr|invesco|fidelity|dimensional|avantis|jpmorgan|wisdomtree|first trust|blackrock|pimco|state street|columbia|pacer|global x|franklin|nuveen|abrdn|goldman sachs/gi, "")
    .replace(/etf|fund|trust|index|portfolio|series/gi, "")
    .trim()

  const signals: string[] = []

  if (/s&p\s*500|sp500/.test(n))           signals.push("sp500")
  if (/s&p\s*100/.test(n))                  signals.push("sp100")
  if (/total\s*(stock|market|us)/.test(n))  signals.push("total-us")
  if (/russell\s*2000|r2000/.test(n))       signals.push("russell2000")
  if (/russell\s*1000/.test(n))             signals.push("russell1000")
  if (/russell\s*3000/.test(n))             signals.push("russell3000")
  if (/nasdaq|qqq|100/.test(n))             signals.push("nasdaq100")
  if (/crsp\s*us\s*large/.test(n))          signals.push("crsp-large")
  if (/crsp\s*us\s*small/.test(n))          signals.push("crsp-small")
  if (/crsp\s*us\s*total/.test(n))          signals.push("crsp-total")
  if (/value/.test(n))                      signals.push("value")
  if (/growth/.test(n))                     signals.push("growth")
  if (/blend/.test(n))                      signals.push("blend")
  if (/equal\s*weight/.test(n))             signals.push("equal-weight")
  if (/min(imum)?\s*vol(atility)?|low\s*vol/.test(n)) signals.push("min-vol")
  if (/momentum/.test(n))                   signals.push("momentum")
  if (/quality/.test(n))                    signals.push("quality")
  if (/small[\s-]cap|small\s*co/.test(n))  signals.push("small-cap")
  if (/mid[\s-]cap/.test(n))               signals.push("mid-cap")
  if (/large[\s-]cap/.test(n))             signals.push("large-cap")
  if (/multi[\s-]factor|factor/.test(n))   signals.push("factor")
  if (/eafe/.test(n))                       signals.push("eafe")
  if (/msci\s*world/.test(n))              signals.push("msci-world")
  if (/ftse\s*dev/.test(n))               signals.push("ftse-developed")
  if (/ftse\s*em|emerging/.test(n))        signals.push("emerging")
  if (/ex[\s-]china/.test(n))              signals.push("ex-china")
  if (/acwi/.test(n))                      signals.push("acwi")
  if (/international|intl|global/.test(n)) signals.push("international")
  if (/aggregate|agg/.test(n))             signals.push("aggregate")
  if (/treasury|govt|government/.test(n))  signals.push("treasury")
  if (/tips|inflation[\s-]protect/.test(n))signals.push("tips")
  if (/high\s*yield|hy/.test(n))           signals.push("high-yield")
  if (/muni|municipal/.test(n))            signals.push("muni")
  if (/mortgage|mbs/.test(n))              signals.push("mbs")
  if (/corporate|corp/.test(n))            signals.push("corporate")
  if (/short[\s-]term|1[\s-]3|0[\s-]3/.test(n)) signals.push("short-term")
  if (/long[\s-]term|20\+|10[\s-]20/.test(n))   signals.push("long-term")
  if (/intermediate|inter/.test(n))        signals.push("intermediate")
  if (/floating\s*rate/.test(n))           signals.push("floating-rate")
  if (/convertible/.test(n))               signals.push("convertible")
  if (/em(erging)?\s*(market)?\s*bond/.test(n))  signals.push("em-bond")
  if (/california|ca\s*muni/.test(n))      signals.push("california-muni")
  if (/technology|tech/.test(n))           signals.push("sector-tech")
  if (/health\s*care|healthcare/.test(n))  signals.push("sector-healthcare")
  if (/energy/.test(n))                    signals.push("sector-energy")
  if (/consumer\s*disc/.test(n))           signals.push("sector-cons-disc")
  if (/real\s*estate|reit/.test(n))        signals.push("sector-realestate")
  if (/infrastructure/.test(n))            signals.push("sector-infra")
  if (/aerospace|defense/.test(n))         signals.push("sector-defense")
  if (/gold/.test(n))                      signals.push("commodity-gold")
  if (/commodity|commodit/.test(n))        signals.push("commodity-broad")

  return signals
}

function fingerprintOverlap(a: string[], b: string[]): number {
  const setA = new Set(a)
  return b.filter(x => setA.has(x)).length
}

export function mapSecurities(
  inputTickers: string[],
  modelId: ModelId,
  msData: MorningstarRow[],
  modelUniverse: ModelUniverseRow[]
  ): MappedSecurity[] {
  const results: (MappedSecurity | null)[] = inputTickers
  const msMap = new Map<string, MorningstarRow>()
  msData.forEach(r => msMap.set(r.ticker.toUpperCase(), r))
  const universeForModel = modelUniverse.filter(r => r.modelId === modelId)
  const universeTickers = new Set(universeForModel.map(r => r.ticker.toUpperCase()))

  return inputTickers
    .map(raw => {
      const ticker = raw.toUpperCase().trim()
      const inputMs = msMap.get(ticker)

      // Already in model — skip entirely
      if (universeTickers.has(ticker)) return null

      if (!inputMs) return { inputTicker: ticker, status: "no-match", mappings: [] } satisfies MappedSecurity

      if (inputMs.splitRegions && inputMs.splitRegions.length > 0) {
        const splitMappings = inputMs.splitRegions.flatMap(split => {
          const candidates = findCandidates(msMap, universeForModel, inputMs.assetClass, split.region)
          return candidates.slice(0, 1).map(c => ({
            ticker: c.ticker, name: c.name, msStyle: c.msStyle,
            assetClass: c.assetClass, region: c.region,
            weight: split.weight,
            note: `${Math.round(split.weight * 100)}% ${split.region} exposure`,
          }))
        })
        if (splitMappings.length > 0) return { inputTicker: ticker, status: "split", mappings: splitMappings } satisfies MappedSecurity
      }

      const candidates = findCandidates(msMap, universeForModel, inputMs.assetClass, inputMs.region)
      if (candidates.length === 0) return { inputTicker: ticker, status: "not-in-model", mappings: [] } satisfies MappedSecurity

      const inputFingerprint = indexFingerprint(inputMs.name)
      const ranked = candidates.sort((a, b) => {
        const aFp = fingerprintOverlap(inputFingerprint, indexFingerprint(a.name))
        const bFp = fingerprintOverlap(inputFingerprint, indexFingerprint(b.name))
        if (bFp !== aFp) return bFp - aFp
        return styleMatchScore(inputMs.msStyle, b.msStyle) - styleMatchScore(inputMs.msStyle, a.msStyle)
      })

      const best = ranked[0]
      return {
        inputTicker: ticker, status: "mapped",
        mappings: [{ ticker: best.ticker, name: best.name, msStyle: best.msStyle, assetClass: best.assetClass, region: best.region }],
      } satisfies MappedSecurity
    })
    .filter((r): r is MappedSecurity => r !== null)
}

function findCandidates(
  msMap: Map<string, MorningstarRow>,
  universeRows: ModelUniverseRow[],
  assetClass: string,
  region: string
): MorningstarRow[] {
  return universeRows
    .map(r => msMap.get(r.ticker.toUpperCase()))
    .filter((ms): ms is MorningstarRow => {
      if (!ms) return false
      const classMatch = ms.assetClass === assetClass
      const regionMatch =
        ms.region === region ||
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
  if (cat.includes("foreign") || cat.includes("europe") || cat.includes("eafe") ||
      cat.includes("international") || ac.includes("global equity")) return "Developed ex-US"
  if (ac.includes("global") || cat.includes("global")) return "Global"
  if (ac.includes("commodities")) return "Global"
  return "US"
}

function inferAssetClass(msCategory: string, rawAssetClass: string): string {
  const cat = msCategory.toLowerCase(), ac = rawAssetClass.toLowerCase()
  if (ac.includes("fixed income") || cat.includes("bond") || cat.includes("muni") ||
      cat.includes("securitized") || cat.includes("ultrashort") || cat.includes("loan")) return "Fixed Income"
  if (ac.includes("commodities") || cat.includes("commodit") ||
      cat.includes("precious metals") || cat.includes("natural resources")) return "Real Assets"
  if (cat.includes("real estate")) return "Real Assets"
  if (ac.includes("global emerging markets equity") || cat.includes("diversified emerging")) return "Intl Equity"
  if (ac.includes("global equity") || cat.includes("foreign") || cat.includes("europe") ||
      cat.includes("india") || cat.includes("china")) return "Intl Equity"
  if (ac.includes("us equity") || cat.includes("large blend") || cat.includes("large value") ||
      cat.includes("large growth") || cat.includes("mid-cap") || cat.includes("small")) return "US Equity"
  if (ac.includes("allocation") || cat.includes("allocation")) return "Allocation"
  if (ac.includes("alternative") || cat.includes("market neutral") ||
      cat.includes("long/short") || cat.includes("systematic trend")) return "Alternative"
  return "Other"
}

export function parseMorningstarExcel(rows: Record<string, string>[]): MorningstarRow[] {
  return rows.map(row => {
    const get = (...keys: string[]) => {
      for (const k of keys) {
        const found = Object.keys(row).find(rk =>
          rk.toLowerCase().replace(/[\s_-]/g,"") === k.toLowerCase().replace(/[\s_-]/g,""))
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
    return {
      ticker, name,
      msStyle: (msCategory || "Unknown") as MsStyle,
      assetClass: inferAssetClass(msCategory, rawAC),
      region: inferRegion(msCategory, rawAC),
      factors,
      ...(splitRegions ? { splitRegions } : {}),
    }
  }).filter(r => r.ticker)
}

export function parseModelUniverseExcel(rows: Record<string, string>[]): ModelUniverseRow[] {
  return rows.map(row => {
    const get = (...keys: string[]) => {
      for (const k of keys) {
        const found = Object.keys(row).find(rk =>
          rk.toLowerCase().replace(/\s/g,"") === k.toLowerCase().replace(/\s/g,""))
        if (found && row[found]) return row[found].trim()
      }
      return ""
    }
    return {
      modelId: get("modelid","model") as ModelId,
      ticker:  get("ticker","symbol").toUpperCase(),
      name:    get("name","fundname"),
      role:    get("role","description"),
    }
  }).filter(r => r.modelId && r.ticker)
}
