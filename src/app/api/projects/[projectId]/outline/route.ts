import { handle, jsonOk, logActivity, parseJson, requirePermission } from '@/lib/api'
import { applyOutline, listOutline } from '@/lib/episodes'
import { requireProjectApi } from '@/lib/project-access'
import { outlineApplySchema } from '@/lib/validators'

export const runtime = 'nodejs'

/** The whole beat sheet, in episode order. */
export const GET = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requirePermission('project.read')
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const url = new URL(request.url)
    const from = Number(url.searchParams.get('from'))
    const to = Number(url.searchParams.get('to'))

    return jsonOk({
      rows: await listOutline(projectId, {
        ...(Number.isFinite(from) && from > 0 ? { from } : {}),
        ...(Number.isFinite(to) && to > 0 ? { to } : {}),
      }),
    })
  }
)

/**
 * Adopts generated outlines for several episodes at once.
 *
 * One transaction: adopting a generated outline is a single decision by the
 * writer, and half-applied would leave them guessing which half.
 */
export const POST = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requirePermission('episode.write')
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, outlineApplySchema)
    const result = await applyOutline(projectId, input.entries)

    await logActivity({
      user,
      action: 'update',
      entityType: 'project',
      entityId: projectId,
      projectId,
      summary: `採用 AI 產生的分集大綱，套用 ${result.applied} 集`,
    })

    return jsonOk(result)
  }
)
