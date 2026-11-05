import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { updateTask } from '@/lib/tasks'
import { taskUpdateSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 改一張卡片 (Z89).
 *
 * 一定要帶 `lockRevision`。`tasks.lock_revision` 這個欄位從第一支 migration
 * 就在，schema 註解寫明用途：「so two simultaneous board drags cannot
 * silently clobber」——不比對的話，兩個人同時改同一張卡，後寫的會安靜地蓋掉
 * 先寫的，而且沒有任何地方會說。
 *
 * 版本對不上回 400 並說明要重新整理，不是靜悄悄地覆蓋。
 */
export const PATCH = handle(
  async (request: Request, context: { params: Promise<{ taskId: string }> }) => {
    const user = await requirePermission('task.write')
    const { taskId } = await context.params

    const { lockRevision, ...patch } = await parseJson(request, taskUpdateSchema)

    const result = await updateTask({ taskId, lockRevision, patch, user })

    return jsonOk(result)
  }
)
