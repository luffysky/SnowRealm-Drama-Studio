import { handle, jsonOk, logActivity, requireUser } from '@/lib/api'
import { unlinkCharacterPortrait } from '@/lib/characters'
import { requireProjectApi } from '@/lib/project-access'

export const runtime = 'nodejs'

/**
 * 把一張圖從角色的圖庫移掉 (Z167).
 *
 * 只解除連結，不刪檔案——檔案留在素材庫。要真的刪檔案走素材中心，那條路會先
 * 檢查還有誰在引用它。
 *
 * 移掉的剛好是定妝照時，`unlinkCharacterPortrait` 會把最早的那一張遞補上
 * 去，並回報遞補到哪一張，好讓介面說出來：角色列表與角色面板的頭像就是這一
 * 張（`key_visual_asset_id` 的唯一讀取端，見 Z168——AI 與分鏡都不讀它），
 * 安靜地換掉它不行。
 */
export const DELETE = handle(
  async (
    _request: Request,
    context: {
      params: Promise<{ projectId: string; characterId: string; assetId: string }>
    }
  ) => {
    const user = await requireUser()
    const { projectId, characterId, assetId } = await context.params
    await requireProjectApi(projectId, user.id)

    const result = await unlinkCharacterPortrait({ projectId, characterId, assetId })

    await logActivity({
      user,
      action: 'update',
      entityType: 'character',
      entityId: characterId,
      projectId,
      summary: result.wasPrimary
        ? `${user.name} 移除了一個角色的定妝照`
        : `${user.name} 移除了一張角色圖`,
    })

    /*
     * 這裡不標記搜尋落後。
     *
     * 搜尋索引吃的是文字——名字、性格、背景。圖庫的增減一個字都沒有改到，標
     * 記了只會讓下一次重算白燒一次 embedding。
     */

    return jsonOk(result)
  }
)
