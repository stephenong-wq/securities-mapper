import { NextRequest, NextResponse } from "next/server"
import { parseImportExcel, processWithBudget, enforceCombinedBudget } from "@/lib/importParser"
import { buildTransition } from "@/lib/transitionEngine"

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get("file") as File
    const gainsBudgetStr = formData.get("gainsBudget") as string | null
    const clientName = (formData.get("clientName") as string | null) || ""
    const userMappingsStr = formData.get("userMappings") as string | null
    const gainsBudget = gainsBudgetStr && parseFloat(gainsBudgetStr) > 0 ? parseFloat(gainsBudgetStr) : null
    const userMappings: Record<string, string> = userMappingsStr ? JSON.parse(userMappingsStr) : {}

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })

    const buffer = await file.arrayBuffer()
    const importResult = parseImportExcel(buffer)

    // Step 1: per-account processing (retirement accounts sell freely)
    const processedPairs = importResult.accounts.map(account => ({
      account,
      accountId: account.accountId,
      accountNumber: account.accountNumber,
      modelName: account.modelName,
      processed: processWithBudget(account, gainsBudget, userMappings),
    }))

    // Step 2: enforce combined gains budget across all taxable accounts
    enforceCombinedBudget(processedPairs, gainsBudget)

    // Step 3: build transition with asset location
    const processedAccounts = processedPairs.map(pa => ({
      accountId: pa.accountId,
      accountNumber: pa.accountNumber,
      modelName: pa.modelName,
      processed: pa.processed,
    }))

    const transition = buildTransition(
      importResult.accounts,
      processedAccounts,
      gainsBudget,
      clientName
    )

    return NextResponse.json({ importResult, processedAccounts, transition })
  } catch (err) {
    console.error("Transition error:", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
