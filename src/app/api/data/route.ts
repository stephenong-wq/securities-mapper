import { NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { parseMorningstarExcel } from "@/lib/mapper"
import { SAMPLE_MORNINGSTAR, SAMPLE_MODEL_UNIVERSE } from "@/lib/sampleData"
import type { ModelUniverseRow, ModelId } from "@/lib/types"

const MS_BLOB_URL      = process.env.MORNINGSTAR_BLOB_URL
const UNIVERSE_BLOB_URL = process.env.MODEL_UNIVERSE_BLOB_URL

// Maps Excel column header → model ID
const HEADER_TO_MODEL_ID: Record<string, ModelId> = {
  "savvy total portfolio":                   "stp",
  "savvy total portfolio - tax aware":       "stp-tax-aware",
  "savvy strategic model":                   "savvy-strategic",
  "savvy strategic model - tax aware":       "savvy-strategic-tax-aware",
  "blackrock target allocation etf model":   "blackrock-target-allocation",
  "vanguard crsp series":                    "vanguard-crsp",
}

async function fetchExcelFromBlob(url: string) {
  const res = await fetch(url, { cache: "no-store" })
  const buffer = await res.arrayBuffer()
  const wb = XLSX.read(buffer, { type: "array" })
  const ws = wb.Sheets[wb.SheetNames[0]]
  return { wb, ws }
}

// Parse the column-per-model format:
// Row 1 = model names (headers), rows below = tickers in each column
function parseModelUniverseColumnFormat(ws: XLSX.WorkSheet): ModelUniverseRow[] {
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1")
  const results: ModelUniverseRow[] = []

  // Row 0 = headers (model names)
  const headers: { col: number; modelId: ModelId }[] = []
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })]
    if (!cell) continue
    const header = String(cell.v).trim().toLowerCase()
    const modelId = HEADER_TO_MODEL_ID[header]
    if (modelId) headers.push({ col: c, modelId })
  }

  // Rows 1+ = tickers
  for (let r = 1; r <= range.e.r; r++) {
    for (const { col, modelId } of headers) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: col })]
      if (!cell) continue
      const ticker = String(cell.v).trim().toUpperCase()
      if (ticker) results.push({ modelId, ticker, name: ticker, role: "" })
    }
  }

  return results
}

export async function GET() {
  try {
    let msData = SAMPLE_MORNINGSTAR
    let universeData = SAMPLE_MODEL_UNIVERSE
    let usingBlob = false

    if (MS_BLOB_URL) {
      const { ws } = await fetchExcelFromBlob(MS_BLOB_URL)
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" })
      msData = parseMorningstarExcel(rows)
    }

    if (UNIVERSE_BLOB_URL) {
      const { ws } = await fetchExcelFromBlob(UNIVERSE_BLOB_URL)
      universeData = parseModelUniverseColumnFormat(ws)
      usingBlob = true
    }

    return NextResponse.json({ msData, universeData, usingBlob })
  } catch (err) {
    console.error("Data load error:", err)
    return NextResponse.json({
      msData: SAMPLE_MORNINGSTAR,
      universeData: SAMPLE_MODEL_UNIVERSE,
      usingBlob: false,
      error: "Could not load blob files — using sample data",
    })
  }
}
