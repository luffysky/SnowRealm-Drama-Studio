import { handle, jsonOk, requirePermission } from '@/lib/api'
import { enqueueAttribution } from '@/lib/attribution-job'
import { requireProjectApi } from '@/lib/project-access'

export const runtime = 'nodejs'
/** Planning reads every chapter of the episode. */
export const maxDuration = 60

type Context = { params: Promise<{ projectId: string; episodeId: string }> }

/**
 * 這一集的對白歸屬 (Z132).
 *
 * 排入一趟判斷。判斷完會停在「待確認」，跟其他 AI 產出一樣——雖然它不會
 * 動到正文一個字（它寫的是「第 37 段是許山河說的」），但配錯聲音也是錯，
 * 只是改回來便宜。
 *
 * **只有 POST** (Z146)。本來還有一支 GET 回報「現在有幾句知道是誰說的」，
 * 但沒有任何介面打過它——有聲書的試算（`?plan=1`）本來就會回
 * `attributedLines`，所以那支是同一個數字的第二個來源。
 *
 * 真正缺的是**跨集的總覽**（哪幾集判過、哪幾集沒有），而那需要一支吃一串
 * 集數的端點，不是這支一次一集的。排進待辦，不在這裡硬湊。
 */
export const POST = handle(async (_request: Request, context: Context) => {
  const user = await requirePermission('ai.run')
  const { projectId, episodeId } = await context.params
  await requireProjectApi(projectId, user.id)

  const queued = await enqueueAttribution({ projectId, episodeId, user })
  return jsonOk(queued, { status: 202 })
})
