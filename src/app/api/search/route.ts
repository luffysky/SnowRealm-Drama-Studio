import { and, desc, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { projects } from '@/db/schema'
import { handle, jsonOk, requireUser } from '@/lib/api'
import { visibleProjects } from '@/lib/project-access'
import { search, type SearchKind } from '@/lib/search'

export const runtime = 'nodejs'

/**
 * Global search, for the ⌘K palette in the top bar.
 *
 * Scope comes from `visibleProjects()`, never from the request: a client that
 * asks for a project it may not see gets that project intersected away rather
 * than honoured.
 */
export const GET = handle(async (request: Request) => {
  const user = await requireUser()

  const url = new URL(request.url)
  const kinds = url.searchParams.getAll('kind') as SearchKind[]
  const requested = url.searchParams.getAll('project')

  const visible = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(visibleProjects(user.id), isNull(projects.deletedAt)))
    .orderBy(desc(projects.isFlagship), desc(projects.createdAt))

  const allowed = visible.map((row) => row.id)
  const projectIds =
    requested.length > 0 ? allowed.filter((id) => requested.includes(id)) : allowed

  const result = await search({
    projectIds,
    query: url.searchParams.get('q') ?? '',
    limit: Math.min(Number(url.searchParams.get('limit')) || 20, 50),
    ...(kinds.length > 0 ? { kinds } : {}),
  })

  return jsonOk(result)
})
