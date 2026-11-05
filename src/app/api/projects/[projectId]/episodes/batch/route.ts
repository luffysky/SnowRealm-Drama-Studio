import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { createEpisodeBatch } from '@/lib/episode-batch'
import { requireProjectApi } from '@/lib/project-access'
import { episodeBatchSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 批次建立集數 (Z66).
 *
 * `episodeBatchSchema` 從很早就在，零個呼叫端——`check:dead` 掃出來的那批
 * 「寫好了沒人用」之一。
 *
 * 一次最多 500 集（schema 擋的），而每一集會順帶長出九筆階段紀錄，所以單次
 * 上限其實是 4,500 列。寫入分批在 `createEpisodeBatch` 裡。
 */
export const POST = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requirePermission('episode.write')
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, episodeBatchSchema)

    const result = await createEpisodeBatch({
      projectId,
      arcId: input.arcId,
      from: input.from,
      to: input.to,
      targetSec: input.targetSec,
      titleTemplate: input.titleTemplate,
      skipExisting: input.skipExisting,
      user,
    })

    return jsonOk(result, { status: 201 })
  }
)
