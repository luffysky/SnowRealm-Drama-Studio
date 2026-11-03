import { handle, jsonOk, requireUser } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { indexStatus, reindexProject } from '@/lib/search'

export const runtime = 'nodejs'

/**
 * Rebuilds a project's search index.
 *
 * Unchanged chunks keep their embedding, so this is cheap to re-run — the
 * response reports how many were actually re-embedded, which is what costs
 * money.
 */
export const POST = handle(
  async (_request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requireUser()
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    return jsonOk(await reindexProject(projectId))
  }
)

/** Index freshness, so the search UI can say whether a reindex is due. */
export const GET = handle(
  async (_request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requireUser()
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    return jsonOk(await indexStatus(projectId))
  }
)
