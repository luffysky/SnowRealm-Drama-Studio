import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { deleteArc, moveEpisodesToArc, updateArc } from '@/lib/arcs'
import { requireProjectApi } from '@/lib/project-access'
import { updateArcSchema } from '@/lib/validators'

export const runtime = 'nodejs'

type Context = { params: Promise<{ projectId: string; arcId: string }> }

/**
 * 改卷名、改規劃集數，或把集數搬進這一卷。
 *
 * Moving is part of the same PATCH rather than its own endpoint because it is
 * the same edit from the dialog's point of view — rename and refile happen in
 * one press — and because `episodeIds` is only ever meaningful against a
 * particular 卷.
 */
export const PATCH = handle(async (request: Request, context: Context) => {
  const user = await requirePermission('episode.write')
  const { projectId, arcId } = await context.params
  await requireProjectApi(projectId, user.id)

  const input = await parseJson(request, updateArcSchema)

  if (
    input.title !== undefined ||
    input.logline !== undefined ||
    input.plannedEpisodes !== undefined
  ) {
    await updateArc({
      projectId,
      arcId,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.logline !== undefined ? { logline: input.logline } : {}),
      ...(input.plannedEpisodes !== undefined
        ? { plannedEpisodes: input.plannedEpisodes }
        : {}),
      user,
    })
  }

  const moved = input.episodeIds
    ? await moveEpisodesToArc({ projectId, arcId, episodeIds: input.episodeIds, user })
    : 0

  return jsonOk({ moved })
})

/**
 * 刪一卷。集數不會跟著消失——見 `deleteArc`，它會先把集數搬走，
 * 而且沒有地方可搬時直接拒絕。
 */
export const DELETE = handle(async (request: Request, context: Context) => {
  const user = await requirePermission('episode.write')
  const { projectId, arcId } = await context.params
  await requireProjectApi(projectId, user.id)

  const moveTo = new URL(request.url).searchParams.get('moveTo')

  const result = await deleteArc({ projectId, arcId, moveTo, user })
  return jsonOk(result)
})
