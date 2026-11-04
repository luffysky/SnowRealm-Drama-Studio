import { ApiError, handle, jsonOk, logActivity, requirePermission } from '@/lib/api'
import { deleteAsset, loadAssetForUser } from '@/lib/assets'
import { requireProjectApi } from '@/lib/project-access'

export const runtime = 'nodejs'

type Context = { params: Promise<{ projectId: string; assetId: string }> }

/**
 * 刪除一個素材 (Z138).
 *
 * `deleteAsset` 早就寫好了——會擋住仍被引用的素材、先刪列再刪 R2 物件——
 * 但**沒有任何地方呼叫它**，所以素材庫從來就沒有刪除鍵。這支路由就是那條
 * 缺掉的線。
 *
 * 權限是 `asset.delete`（只有擁有者）。刪除是這個素材庫裡唯一真正不可逆的
 * 動作：R2 的物件沒有版本，刪了就是刪了。
 */
export const DELETE = handle(async (_request: Request, context: Context) => {
  const user = await requirePermission('asset.delete')
  const { projectId, assetId } = await context.params

  // Route Handlers do not inherit the layout's check (docs/ROUTES.md §5).
  await requireProjectApi(projectId, user.id)

  /*
   * Read it first, for two reasons: the activity log should say what was
   * deleted rather than an id, and an asset from another project must not be
   * deletable through this project's route.
   */
  const asset = await loadAssetForUser(assetId, user)
  if (asset.projectId !== projectId) {
    throw ApiError.notFound('找不到這個素材')
  }

  await deleteAsset({ user, assetId })

  await logActivity({
    user,
    action: 'delete',
    entityType: 'asset',
    entityId: assetId,
    projectId,
    summary: `${user.name} 刪除素材「${asset.title || asset.name}」`,
  })

  return jsonOk({ deleted: assetId })
})
