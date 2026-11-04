import { handle, jsonOk, parseJson, requirePermission, requireUser } from '@/lib/api'
import { promoteSpeakers, unlistedSpeakers } from '@/lib/attribution-job'
import { requireProjectApi } from '@/lib/project-access'
import { promoteSpeakersSchema } from '@/lib/validators'

export const runtime = 'nodejs'

type Context = { params: Promise<{ projectId: string }> }

/**
 * 在正文裡說過話、但角色表沒有的人 (Z137).
 *
 * `GET` 列出來，`POST` 把選中的建成角色。
 *
 * 刻意不自動建：那是作者的資料。「周圍的百姓」不是角色，「路人」也不是，
 * 而「陸承安」顯然是——只有人分得出來。
 */
export const GET = handle(async (_request: Request, context: Context) => {
  const user = await requireUser()
  const { projectId } = await context.params

  // Route Handlers do not inherit the layout's check (docs/ROUTES.md §5).
  await requireProjectApi(projectId, user.id)

  return jsonOk({ speakers: await unlistedSpeakers(projectId) })
})

export const POST = handle(async (request: Request, context: Context) => {
  const user = await requirePermission('character.write')
  const { projectId } = await context.params
  await requireProjectApi(projectId, user.id)

  const input = await parseJson(request, promoteSpeakersSchema)
  const result = await promoteSpeakers({ projectId, names: input.names, user })

  return jsonOk(result, { status: 201 })
})
