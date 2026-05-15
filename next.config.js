import { NextRequest, NextResponse } from "next/server"
import { mapSecurities } from "@/lib/mapper"
import type { MorningstarRow, ModelUniverseRow, ModelId } from "@/lib/types"

export async function POST(req: NextRequest) {
  try {
    const { tickers, modelId, msData, universeData } = await req.json() as {
      tickers: string[]
      modelId: ModelId
      msData: MorningstarRow[]
      universeData: ModelUniverseRow[]
    }

    if (!tickers?.length || !modelId) {
      return NextResponse.json({ error: "Missing tickers or modelId" }, { status: 400 })
    }

    const results = mapSecurities(tickers, modelId, msData, universeData)
    return NextResponse.json({ results })
  } catch (err) {
    console.error("Mapping error:", err)
    return NextResponse.json({ error: "Mapping failed" }, { status: 500 })
  }
}
