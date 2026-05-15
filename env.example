import { NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { parseMorningstarExcel, parseModelUniverseExcel } from "@/lib/mapper"
import { SAMPLE_MORNINGSTAR, SAMPLE_MODEL_UNIVERSE } from "@/lib/sampleData"

// Vercel Blob URLs — set these in your Vercel env vars after uploading files
const MS_BLOB_URL = process.env.MORNINGSTAR_BLOB_URL
const UNIVERSE_BLOB_URL = process.env.MODEL_UNIVERSE_BLOB_URL

async function fetchExcelFromBlob(url: string) {
  const res = await fetch(url, { next: { revalidate: 3600 } }) // cache 1hr
  const buffer = await res.arrayBuffer()
  const wb = XLSX.read(buffer, { type: "array" })
  const ws = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" })
}

export async function GET() {
  try {
    let msData = SAMPLE_MORNINGSTAR
    let universeData = SAMPLE_MODEL_UNIVERSE

    // Try to load from Vercel Blob if URLs are configured
    if (MS_BLOB_URL) {
      const rows = await fetchExcelFromBlob(MS_BLOB_URL)
      msData = parseMorningstarExcel(rows)
    }
    if (UNIVERSE_BLOB_URL) {
      const rows = await fetchExcelFromBlob(UNIVERSE_BLOB_URL)
      universeData = parseModelUniverseExcel(rows)
    }

    return NextResponse.json({
      msData,
      universeData,
      usingBlob: !!(MS_BLOB_URL && UNIVERSE_BLOB_URL),
    })
  } catch (err) {
    console.error("Data load error:", err)
    // Always fall back to sample data
    return NextResponse.json({
      msData: SAMPLE_MORNINGSTAR,
      universeData: SAMPLE_MODEL_UNIVERSE,
      usingBlob: false,
      error: "Could not load blob files — using sample data",
    })
  }
}
