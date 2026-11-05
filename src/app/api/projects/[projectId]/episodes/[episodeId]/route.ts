import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { updateEpisode } from '@/lib/episodes'
import { requireProjectApi } from '@/lib/project-access'
import { markSearchDirty } from '@/lib/search'
import { episodeEditSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 改一集 (Z35).
 *
 * 詳情列上那支鉛筆在這之前是個禁用的 `<span>`，標題寫著「集數編輯尚未實作，
 * 預計於 M1 階段交付」——而 M1 是很久以前的事了。
 *
 * 沒有 DELETE：刪一集會連著小說、劇本、分鏡、九筆階段紀錄一起走
 * （`on delete cascade`），那是另一件要認真設計確認流程的事，不該順手掛在
 * 這支上。
 */
export const PATCH = handle(
  async (
    request: Request,
    context: { params: Promise<{ projectId: string; episodeId: string }> }
  ) => {
    const user = await requirePermission('episode.write')
    const { projectId, episodeId } = await context.params
    await requireProjectApi(projectId, user.id)

    const patch = await parseJson(request, episodeEditSchema)
    const result = await updateEpisode({ projectId, episodeId, patch, user })

    /*
     * 內容變了，索引就落後了 (Z165).
     *
     * `title`／`logline`／`synopsis`／`notes` 四欄都進搜尋索引，而全專案 22
     * 處 `markSearchDirty` 全在路由層——這一支漏了。漏掉的後果是改完標題之
     * 後，搜尋裡那段文字跟「不存在」分不出來，而索引狀態還回報「最新」。
     *
     * 隔壁的 `outline/route.ts` 與 `episodes/batch/route.ts` 做的是同一件事。
     */
    await markSearchDirty(projectId)

    return jsonOk(result)
  }
)
