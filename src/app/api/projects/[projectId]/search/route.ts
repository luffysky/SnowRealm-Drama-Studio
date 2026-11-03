import { handle, jsonOk, requireUser } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { search, type SearchKind } from '@/lib/search'

export const runtime = 'nodejs'

/**
 * Hybrid search over one project.
 *
 * GET rather than POST: a search is a read, and it being a URL means a result
 * list can be linked to.
 */
export const GET = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requireUser()
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const url = new URL(request.url)
    const kinds = url.searchParams.getAll('kind') as SearchKind[]

    const result = await search({
      projectIds: [projectId],
      query: url.searchParams.get('q') ?? '',
      limit: Math.min(Number(url.searchParams.get('limit')) || 20, 50),
      ...(kinds.length > 0 ? { kinds } : {}),
    })

    return jsonOk(result)
  }
)
