import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { deleteShot, updateShot } from '@/lib/storyboard'
import { shotPatchSchema } from '@/lib/validators'

export const runtime = 'nodejs'

type Context = { params: Promise<{ projectId: string; shotId: string }> }

/** 改一個鏡頭的欄位 (Z39/Z40). */
export const PATCH = handle(async (request: Request, context: Context) => {
  const user = await requirePermission('episode.write')
  const { projectId, shotId } = await context.params
  await requireProjectApi(projectId, user.id)

  const patch = await parseJson(request, shotPatchSchema)
  const result = await updateShot({ projectId, shotId, patch, user })

  return jsonOk(result)
})

/**
 * 刪掉一個鏡頭 (Z39).
 *
 * 真的刪掉，不是軟刪：`shots` 沒有 `deleted_at`，而鏡頭是規劃中的草稿，不是
 * spec v2 §5 要求保留的「重要內容」。後面的鏡頭序號會往前遞補，見 `deleteShot`。
 */
export const DELETE = handle(async (_request: Request, context: Context) => {
  const user = await requirePermission('episode.write')
  const { projectId, shotId } = await context.params
  await requireProjectApi(projectId, user.id)

  await deleteShot({ projectId, shotId, user })

  return jsonOk({ ok: true })
})
