import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { createArc } from '@/lib/arcs'
import { requireProjectApi } from '@/lib/project-access'
import { createArcSchema } from '@/lib/validators'

export const runtime = 'nodejs'

type Context = { params: Promise<{ projectId: string }> }

/*
 * **只有 POST。** 卷的清單由集數頁與看小說頁在伺服器端呼叫 `listArcs()`
 * 渲染，所以本來那支 GET 沒有任何呼叫端 (Z146)。
 */

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
