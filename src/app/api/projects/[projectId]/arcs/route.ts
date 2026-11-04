import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { createArc, listArcs } from '@/lib/arcs'
import { requireProjectApi } from '@/lib/project-access'
import { createArcSchema } from '@/lib/validators'

export const runtime = 'nodejs'

type Context = { params: Promise<{ projectId: string }> }

/** 這部作品有哪幾卷，各收了哪些集。 */
export const GET = handle(async (_request: Request, context: Context) => {
  const user = await requirePermission('project.read')
  const { projectId } = await context.params

  // Route Handlers do not inherit the layout's check (docs/ROUTES.md §5).
  await requireProjectApi(projectId, user.id)

  return jsonOk({ arcs: await listArcs(projectId) })
})

/** 新增一卷。它一開始是空的，集數再搬進去。 */
export const POST = handle(async (request: Request, context: Context) => {
  const user = await requirePermission('episode.write')
  const { projectId } = await context.params
  await requireProjectApi(projectId, user.id)

  const input = await parseJson(request, createArcSchema)
  const arc = await createArc({
    projectId,
    title: input.title,
    logline: input.logline,
    user,
  })

  return jsonOk({ arc }, { status: 201 })
})
