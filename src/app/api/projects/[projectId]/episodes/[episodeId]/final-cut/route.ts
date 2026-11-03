import { ApiError, handle, jsonOk, logActivity, parseJson, requirePermission } from '@/lib/api'
import { episodeCuts, updateEpisodeFinalCut } from '@/lib/episodes'
import { requireProjectApi } from '@/lib/project-access'
import { finalCutSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 集數成片 (Z1).
 *
 * The finished cut is an ordinary asset; this records *which* one it is.
 * Being a VIDEO attached to the episode is not enough to identify it —
 * storyboard previews, source clips and rejected takes all satisfy that.
 */
export const GET = handle(
  async (
    _request: Request,
    context: { params: Promise<{ projectId: string; episodeId: string }> }
  ) => {
    const user = await requirePermission('project.read')
    const { projectId, episodeId } = await context.params
    await requireProjectApi(projectId, user.id)

    return jsonOk(await episodeCuts(projectId, episodeId))
  }
)

/**
 * Points the episode at a cut, or clears it with `null`.
 *
 * Switching cuts never deletes the previous file: it stays in the project as
 * an earlier version and can be promoted back. A released episode therefore
 * remains traceable to the exact file that was released.
 */
export const PATCH = handle(
  async (
    request: Request,
    context: { params: Promise<{ projectId: string; episodeId: string }> }
  ) => {
    const user = await requirePermission('episode.write')
    const { projectId, episodeId } = await context.params
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, finalCutSchema)

    const row = await updateEpisodeFinalCut(projectId, episodeId, input.assetId)
    if (!row) throw new ApiError(404, '找不到這一集', 'episode_not_found')

    await logActivity({
      user,
      action: 'update',
      entityType: 'episode',
      entityId: row.id,
      projectId,
      summary: input.assetId ? '設定本集成片' : '移除本集成片',
    })

    return jsonOk(row)
  }
)
