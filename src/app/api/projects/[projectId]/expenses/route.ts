import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { addExpense } from '@/lib/costs-write'
import { expenseCreateSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 手動記一筆支出 (Z197).
 *
 * 在這之前 `expenses` 只有兩個寫入點——AI 任務自己記帳，以及匯入 CSV。介面上
 * 沒有任何地方可以記一筆，而成本頁的空狀態寫著「排一個 AI 任務**或記一筆支
 * 出**之後，這裡就會有數字」。
 *
 * `projectId` 用網址上的那一個，因為它是已經驗過權限的那一個。
 */
export const POST = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requirePermission('expense.write')
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, expenseCreateSchema)
    const expense = await addExpense({ projectId, ...input }, user)

    return jsonOk({ expense }, { status: 201 })
  }
)
