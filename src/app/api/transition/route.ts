import { NextRequest, NextResponse } from "next/server"
import { parseImportExcel, processWithBudget } from "@/lib/importParser"
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

    const processedAccounts = importResult.accounts.map(account => ({
      accountId: account.accountId,
      accountNumber: account.accountNumber,
      modelName: account.modelName,
      // Apply userMappings overrides to unassigned holdings before processing
      processed: processWithBudget(
        {
          ...account,
          unassigned: account.unassigned.map(h => {
            if (userMappings[h.ticker]) {
              // User has overridden this mapping — store override for processWithBudget to use
              return { ...h, _userMappingOverride: userMappings[h.ticker] }
            }
            return h
          }),
        },
        gainsBudget,
        userMappings
      ),
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
