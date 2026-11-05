import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { createEpisodeBatch } from '@/lib/episode-batch'
import { requireProjectApi } from '@/lib/project-access'
import { markSearchDirty } from '@/lib/search'
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

    /*
     * 內容變了，索引就落後了 (Z164).
     *
     * `episodes.title / logline / synopsis / notes` 都是可索引的文字，而另外
     * 17 支寫入路徑每一支都呼叫這個——漏掉的話，用樣板一次建 120 集，那 120
     * 個標題在搜尋裡**完全不存在**，而 `searchIndexStatus()` 仍然回報「索引
     * 是最新的」。那正是 `searchDirtyAt` 的註解在講的事：跟「那段文字不存在」
     * 分不出來。
     */
    await markSearchDirty(projectId)

    return jsonOk(result, { status: 201 })
  }
)
