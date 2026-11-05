import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { promoteSpeakers } from '@/lib/attribution-job'
import { requireProjectApi } from '@/lib/project-access'
import { promoteSpeakersSchema } from '@/lib/validators'

export const runtime = 'nodejs'

type Context = { params: Promise<{ projectId: string }> }

/**
 * 在正文裡說過話、但角色表沒有的人 (Z137).
 *
 * 刻意不自動建：那是作者的資料。「周圍的百姓」不是角色，「路人」也不是，
 * 而「陸承安」顯然是——只有人分得出來。
 *
 * **只有 POST。** 名單由看小說那一頁在伺服器端呼叫 `unlistedSpeakers()`
 * 渲染，所以本來那支 GET 沒有任何呼叫端 (Z146)。
 */
export const POST = handle(async (request: Request, context: Context) => {
  const user = await requirePermission('character.write')
  const { projectId } = await context.params
  await requireProjectApi(projectId, user.id)

  const input = await parseJson(request, promoteSpeakersSchema)
  const result = await promoteSpeakers({
    projectId,
    names: input.names,
    tier: input.tier,
    user,
  })

  return jsonOk(result, { status: 201 })
})
