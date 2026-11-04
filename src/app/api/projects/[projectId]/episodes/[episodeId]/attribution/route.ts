import { handle, jsonOk, requirePermission, requireUser } from '@/lib/api'
import { attributionStatus, enqueueAttribution, speakersFor } from '@/lib/attribution-job'
import { requireProjectApi } from '@/lib/project-access'

export const runtime = 'nodejs'
/** Planning reads every chapter of the episode. */
export const maxDuration = 60

type Context = { params: Promise<{ projectId: string; episodeId: string }> }

/**
 * 這一集的對白歸屬 (Z132).
 *
 * `GET` 說現在有幾句知道是誰說的；`POST` 排入一趟判斷。
 *
 * 判斷完會停在「待確認」，跟其他 AI 產出一樣——雖然它不會動到正文一個字
 * （它寫的是「第 37 段是許山河說的」），但配錯聲音也是錯，只是改回來便宜。
 */
export const GET = handle(async (_request: Request, context: Context) => {
  const user = await requireUser()
  const { projectId, episodeId } = await context.params

  // Route Handlers do not inherit the layout's check (docs/ROUTES.md §5).
  await requireProjectApi(projectId, user.id)

  const [speakers, status] = await Promise.all([
    speakersFor(episodeId),
    attributionStatus([episodeId]),
  ])

  const summary = status.get(episodeId)

  return jsonOk({
    lines: summary?.lines ?? 0,
    characters: summary?.characters ?? 0,
    names: [...new Set(speakers.values())].slice(0, 20),
  })
})

export const POST = handle(async (_request: Request, context: Context) => {
  const user = await requirePermission('ai.run')
  const { projectId, episodeId } = await context.params
  await requireProjectApi(projectId, user.id)

  const queued = await enqueueAttribution({ projectId, episodeId, user })
  return jsonOk(queued, { status: 202 })
})
