import { NextRequest, NextResponse } from "next/server"
import { parseImportExcel, processWithBudget } from "@/lib/importParser"

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get("file") as File
    const gainsBudgetStr = formData.get("gainsBudget") as string | null
    const gainsBudget = gainsBudgetStr && parseFloat(gainsBudgetStr) > 0 ? parseFloat(gainsBudgetStr) : null

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })

    const buffer = await file.arrayBuffer()
    const importResult = parseImportExcel(buffer)

    const processedAccounts = importResult.accounts.map(account => ({
      accountId: account.accountId,
      accountNumber: account.accountNumber,
      modelName: account.modelName,
      processed: processWithBudget(account, gainsBudget),
    }))

    return NextResponse.json({ importResult, processedAccounts })
  } catch (err) {
    console.error("Import error:", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
