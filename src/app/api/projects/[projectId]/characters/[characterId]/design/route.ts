import { handle, jsonOk, requirePermission } from '@/lib/api'
import { enqueueCharacterDesign } from '@/lib/character-design'
import { requireProjectApi } from '@/lib/project-access'

export const runtime = 'nodejs'

type Context = { params: Promise<{ projectId: string; characterId: string }> }

/**
 * 排一趟「角色設計與定妝」(Z70).
 *
 * `CHARACTER_DESIGN` 的 prompt、定價、佇列本來就都在，**介面上沒有任何地方
 * 按得到**——七個這種任務之一（`npm run check:ai`）。
 *
 * 跟對白歸屬同一個形狀：這裡只排隊，產出停在 AI 製片中心的「待確認」，人
 * 按了採用才會寫進角色。而採用走的是 `applyCharacterDesign()`，它**只填原本
 * 空著的欄位**——角色設定沒有版本歷史，蓋掉就是真的沒了。
 */
export const POST = handle(async (_request: Request, context: Context) => {
  const user = await requirePermission('ai.run')
  const { projectId, characterId } = await context.params

  // Route Handlers do not inherit the layout's check (docs/ROUTES.md §5).
  await requireProjectApi(projectId, user.id)

  const result = await enqueueCharacterDesign({ projectId, characterId, user })

  return jsonOk(result, { status: 201 })
})
