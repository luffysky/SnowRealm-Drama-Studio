import { handle, jsonOk, requirePermission } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { deleteBudget } from '@/lib/costs-write'

export const runtime = 'nodejs'

/** 移除一個預算上限 (Z197)。移掉之後那個範圍就不再擋任何任務。 */
export const DELETE = handle(
  async (
    _request: Request,
    context: { params: Promise<{ projectId: string; budgetId: string }> }
  ) => {
    const user = await requirePermission('expense.write')
    const { projectId, budgetId } = await context.params
    await requireProjectApi(projectId, user.id)

    await deleteBudget(projectId, budgetId, user)

    return jsonOk({ ok: true })
  }
)
