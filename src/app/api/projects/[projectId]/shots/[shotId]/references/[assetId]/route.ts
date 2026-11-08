import { handle, jsonOk, logActivity, requirePermission } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { unlinkShotReference } from '@/lib/storyboard'

export const runtime = 'nodejs'

/**
 * 把一張參考圖從鏡頭上移掉 (Z183).
 *
 * 只解除連結，不刪檔案——檔案留在素材庫，要真的刪走素材中心，那條路會先檢查
 * 還有誰在引用它。跟角色圖庫同一個規矩（Z167），而規矩一致本身就是功能：一
 * 個地方的「移除」會刪檔、另一個不會，使用者只能靠試。
 *
 * 新增走的是一般上傳（`POST /api/uploads` 帶 `linkTo`），所以這裡只有
 * DELETE——上傳要簽 R2、要分段、要續傳，再寫一支只會變成第二個實作。
 */
export const DELETE = handle(
  async (
    _request: Request,
    context: {
      params: Promise<{ projectId: string; shotId: string; assetId: string }>
    }
  ) => {
    /*
     * `shot.write`，跟同一個資料夾的 PATCH／DELETE 一致 (Z183).
     *
     * 介面的 `canWrite` 就是 `can(user, 'shot.write')`，所以路由用
     * `requireUser` 等於「按鈕看不到，但 API 擋不住」。今天兩個角色都拿得到
     * 這個權限，所以不是洞——但等真的加一個窄角色時，它會是漏的那一支。
     */
    const user = await requirePermission('shot.write')
    const { projectId, shotId, assetId } = await context.params
    await requireProjectApi(projectId, user.id)

    await unlinkShotReference({ projectId, shotId, assetId })

    await logActivity({
      user,
      action: 'update',
      entityType: 'shot',
      entityId: shotId,
      projectId,
      summary: `${user.name} 移除了一張鏡頭參考圖`,
    })

    return jsonOk({ ok: true })
  }
)
