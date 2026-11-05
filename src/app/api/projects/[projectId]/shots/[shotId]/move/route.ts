import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { moveShot } from '@/lib/storyboard'
import { shotMoveSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 把一個鏡頭往前或往後挪一格 (Z39).
 *
 * 收的是方向，不是新的序號。給序號就得在這裡處理「中間那些怎麼重排」，而
 * `unique(episode_id, order)` 讓每一種重排都是一次可能的衝突——交換兩格的那
 * 個三步驟寫在 `moveShot` 裡，連同為什麼要三步。
 */
export const POST = handle(
  async (
    request: Request,
    context: { params: Promise<{ projectId: string; shotId: string }> }
  ) => {
    const user = await requirePermission('shot.write')
    const { projectId, shotId } = await context.params
    await requireProjectApi(projectId, user.id)

    const { direction } = await parseJson(request, shotMoveSchema)
    const result = await moveShot({ projectId, shotId, direction, user })

    return jsonOk(result)
  }
)
