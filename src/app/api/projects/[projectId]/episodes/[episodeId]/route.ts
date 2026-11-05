import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { updateEpisode } from '@/lib/episodes'
import { requireProjectApi } from '@/lib/project-access'
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

    return jsonOk(result)
  }
)
