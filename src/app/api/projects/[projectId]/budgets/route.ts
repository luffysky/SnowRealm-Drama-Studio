import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { upsertBudget } from '@/lib/costs-write'
import { budgetSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 設一個預算上限 (Z197).
 *
 * `budgets` 在這之前是三個地方讀、**零個地方寫**——所以
 * `assertWithinBudget` 每一次都回「沒有上限，放行」，而規格 §6.7 的「超支擋
 * 下任務」是一個裝飾品。
 *
 * 同一個範圍（作品＋類別＋期間）已經有了就改掉它，不會長出第二列。
 */
export const POST = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requirePermission('expense.write')
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, budgetSchema)
    const budget = await upsertBudget({ projectId, ...input }, user)

    return jsonOk({ budget }, { status: 201 })
  }
)
