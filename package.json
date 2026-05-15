import type { MorningstarRow, ModelUniverseRow, ModelId, MappedSecurity, MsStyle } from "./types"

// ─── Mapping engine ────────────────────────────────────────────────────────────
// Strategy:
// 1. If the input ticker is already in the model universe → map to itself (with MS data)
// 2. If it has Morningstar data → find model tickers with the same assetClass/region
//    - If input has splitRegions → create split mappings weighted by exposure
// 3. No match found → status = "no-match"

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

    // ── Already in model universe ──────────────────────────────────────────────
    if (universeTickers.has(ticker)) {
      const ms = inputMs ?? { name: ticker, msStyle: "Unknown" as MsStyle, assetClass: "-", region: "-" }
      return {
        inputTicker: ticker,
        status: "mapped",
        mappings: [{
          ticker,
          name: ms.name,
          msStyle: ms.msStyle,
          assetClass: ms.assetClass,
          region: ms.region,
        }],
      } satisfies MappedSecurity
    }

    // ── Not in MS data at all ──────────────────────────────────────────────────
    if (!inputMs) {
      return {
        inputTicker: ticker,
        status: "no-match",
        mappings: [],
      } satisfies MappedSecurity
    }

    // ── Split-region fund (e.g. IXUS, VXUS) ──────────────────────────────────
    if (inputMs.splitRegions && inputMs.splitRegions.length > 0) {
      const splitMappings = inputMs.splitRegions.flatMap(split => {
        const candidates = findCandidates(msMap, universeForModel, inputMs.assetClass, split.region)
        return candidates.map(c => ({
          ticker: c.ticker,
          name: c.name,
          msStyle: c.msStyle,
          assetClass: c.assetClass,
          region: c.region,
          weight: split.weight,
          note: `${Math.round(split.weight * 100)}% ${split.region} exposure`,
        }))
      })

      if (splitMappings.length > 0) {
        return { inputTicker: ticker, status: "split", mappings: splitMappings } satisfies MappedSecurity
      }
    }

    // ── Standard single-region match ──────────────────────────────────────────
    const candidates = findCandidates(msMap, universeForModel, inputMs.assetClass, inputMs.region)

    if (candidates.length === 0) {
      return { inputTicker: ticker, status: "not-in-model", mappings: [] } satisfies MappedSecurity
    }

    // Prefer the best style-box match
    const ranked = candidates.sort((a, b) => {
      const aScore = styleMatchScore(inputMs.msStyle, a.msStyle)
      const bScore = styleMatchScore(inputMs.msStyle, b.msStyle)
      return bScore - aScore
    })

    const best = ranked[0]
    return {
      inputTicker: ticker,
      status: "mapped",
      mappings: [{
        ticker: best.ticker,
        name: best.name,
        msStyle: best.msStyle,
        assetClass: best.assetClass,
        region: best.region,
        note: candidates.length > 1 ? `Also consider: ${ranked.slice(1).map(r => r.ticker).join(", ")}` : undefined,
      }],
    } satisfies MappedSecurity
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
      // Region matching: allow "Global ex-US" to match "Developed ex-US" or "Emerging"
      const regionMatch =
        ms.region === region ||
        (region === "Global ex-US" && (ms.region === "Developed ex-US" || ms.region === "Emerging")) ||
        (ms.region === "Global ex-US" && (region === "Developed ex-US" || region === "Emerging"))
      return classMatch && regionMatch
    })
}

function styleMatchScore(input: MsStyle, candidate: MsStyle): number {
  if (input === candidate) return 3
  // Same size, different style
  const inputParts = input.split(" ")
  const candParts = candidate.split(" ")
  if (inputParts[0] === candParts[0]) return 2
  // Same style, different size (e.g. both "Value")
  if (inputParts[inputParts.length - 1] === candParts[candParts.length - 1]) return 1
  return 0
}

// ─── Excel / CSV loader ───────────────────────────────────────────────────────
// These parse the uploaded Blob files. Column names are flexible — we normalize.
export function parseMorningstarExcel(rows: Record<string, string>[]): MorningstarRow[] {
  return rows.map(row => {
    const get = (...keys: string[]) => {
      for (const k of keys) {
        const found = Object.keys(row).find(rk => rk.toLowerCase().replace(/\s/g,"") === k.toLowerCase().replace(/\s/g,""))
        if (found && row[found]) return row[found].trim()
      }
      return ""
    }
    const ticker = get("ticker","symbol").toUpperCase()
    const factors = get("factors","factor").split(",").map(s => s.trim()).filter(Boolean)
    const splitStr = get("splitregions","regions")
    let splitRegions: { region: string; weight: number }[] | undefined
    if (splitStr) {
      // Expected format: "Developed ex-US:0.78,Emerging:0.22"
      splitRegions = splitStr.split(",").map(s => {
        const [region, weight] = s.split(":")
        return { region: region.trim(), weight: parseFloat(weight) || 0 }
      }).filter(r => r.region)
    }
    return {
      ticker,
      name: get("name","fundname","fund name"),
      msStyle: (get("msstyle","style","morningstarstyle","morningstar style") || "Unknown") as MsStyle,
      assetClass: get("assetclass","asset class","category"),
      region: get("region"),
      factors,
      ...(splitRegions ? { splitRegions } : {}),
    }
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
    return {
      modelId: get("modelid","model") as ModelId,
      ticker: get("ticker","symbol").toUpperCase(),
      name: get("name","fundname"),
      role: get("role","description"),
    }
  }).filter(r => r.modelId && r.ticker)
}
