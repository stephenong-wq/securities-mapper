import { NextRequest, NextResponse } from "next/server"
import { parseImportExcel, processWithBudget } from "@/lib/importParser"
import { buildTransition } from "@/lib/transitionEngine"

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get("file") as File
    const gainsBudgetStr = formData.get("gainsBudget") as string | null
    const clientName = formData.get("clientName") as string || "Client"
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

    const transition = buildTransition(
      importResult.accounts,
      processedAccounts,
      gainsBudget,
      clientName
    )

    return NextResponse.json({ transition, processedAccounts, importResult })
  } catch (err) {
    console.error("Transition error:", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
