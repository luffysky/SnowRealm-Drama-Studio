import { handle, jsonOk, logActivity, parseJson, requirePermission } from '@/lib/api'
import { ApiError } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { novelTitleOf, dramaTitleOf } from '@/lib/project-titles'
import { updateProject } from '@/lib/projects'
import { projectUpdateSchema } from '@/lib/validators'
import { reindexProject } from '@/lib/search'

export const runtime = 'nodejs'

/**
 * 作品設定: rename the work, the novel or the drama, and set the cover.
 *
 * The cover is stored as an asset id, not a URL. The bucket is private, so the
 * browser reads it through `/api/files/[assetId]`, which checks the session
 * and then redirects to a short-lived presigned URL — a URL written into the
 * row would expire (`docs/ENVIRONMENT.md` §2).
 */
export const PATCH = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requirePermission('project.write')
    const { projectId } = await context.params
    const before = await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, projectUpdateSchema)

    const row = await updateProject(projectId, user.id, input)
    if (!row) throw new ApiError(404, '找不到這個作品', 'project_not_found')

    await logActivity({
      user,
      action: 'update',
      entityType: 'project',
      entityId: projectId,
      projectId,
      summary: summarise(before.title, input),
    })

    /*
     * The titles are indexed, so a rename that is not reflected in search
     * would make the work unfindable under its new name. Only a rename needs
     * this — a new cover changes no text — and it is cheap: the content hash
     * is unchanged for everything except the project row itself.
     */
    if (
      input.title !== undefined ||
      input.novelTitle !== undefined ||
      input.dramaTitle !== undefined ||
      input.logline !== undefined ||
      input.synopsis !== undefined
    ) {
      await reindexProject(projectId).catch(() => {
        // A stale index is not a reason to fail the save; the search panel
        // has a 重建索引 button for exactly this.
      })
    }

    return jsonOk({
      id: row.id,
      title: row.title,
      novelTitle: row.novelTitle,
      dramaTitle: row.dramaTitle,
      /** Resolved for the client, so it does not repeat the fallback rule. */
      novelTitleResolved: novelTitleOf(row),
      dramaTitleResolved: dramaTitleOf(row),
      coverAssetId: row.coverAssetId,
      /*
       * How many episodes followed the new 片長 (Z130). Reported rather than
       * assumed: a save that silently moved 120 rows and one that moved none
       * look identical otherwise.
       */
      episodesRetargeted: row.episodesRetargeted,
    })
  }
)

/** What the activity log should say. Vague entries make the log useless. */
function summarise(
  previousTitle: string,
  input: {
    title?: string
    novelTitle?: string
    dramaTitle?: string
    logline?: string
    synopsis?: string
    coverAssetId?: string | null
  }
): string {
  const parts: string[] = []

  if (input.title !== undefined && input.title !== previousTitle) {
    parts.push(`作品名稱改為「${input.title}」`)
  }
  if (input.novelTitle !== undefined) {
    parts.push(input.novelTitle ? `小說書名改為「${input.novelTitle}」` : '小說書名改為與作品名稱相同')
  }
  if (input.dramaTitle !== undefined) {
    parts.push(input.dramaTitle ? `短劇劇名改為「${input.dramaTitle}」` : '短劇劇名改為與作品名稱相同')
  }
  if (input.coverAssetId !== undefined) {
    parts.push(input.coverAssetId ? '更換封面' : '移除封面')
  }
  if (input.logline !== undefined) parts.push('更新一句話簡介')
  if (input.synopsis !== undefined) parts.push('更新故事大綱')

  return parts.length > 0 ? `更新作品設定：${parts.join('、')}` : '更新作品設定'
}
