import { z } from 'zod'
import { ApiError, handle, jsonOk, logActivity, parseJson, requireUser } from '@/lib/api'
import { applyImport, applyNovelDocument, buildMapContext } from '@/lib/import/apply'
import { mapRows } from '@/lib/import/map'
import { importTarget } from '@/lib/import/targets'
import { IMPORT_TARGETS } from '@/lib/import/targets'
import { requireProjectApi } from '@/lib/project-access'

export const runtime = 'nodejs'

const bodySchema = z.object({
  target: z.enum(IMPORT_TARGETS.map((item) => item.key) as [string, ...string[]]),
  episodeId: z.string().uuid().nullable().optional(),
  /** 第幾欄對到哪個欄位，`null` 代表不匯入。 */
  mapping: z.array(z.string().nullable()).max(200).optional(),
  sheet: z
    .object({
      headers: z.array(z.string()).max(200),
      rows: z.array(z.array(z.string()).max(200)).max(5000),
      format: z.string(),
    })
    .optional(),
  /** 小說那一種走這個：整份 Markdown，伺服器端自己再剖一次。 */
  docText: z.string().max(400_000).optional(),
})

/**
 * 真的寫進去 (Z185).
 *
 * 吃的是 `preview` 回去的那張表加上**人確認過的對應**——不是重新猜一次。自動
 * 對應只是起點：一個猜錯的對應會把台詞存進「誰說的」，而它不報錯，要到配音
 * 的時候才有人發現。
 *
 * 這裡**再跑一次 `mapRows`**，不信任用戶端送來的值。前端算過一次是為了預
 * 覽，而預覽與實際寫入用同一支純函式跑同一份輸入——兩邊各自解讀的話，畫面說
 * 「沒問題」而資料庫拿到別的東西。
 */
export const POST = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requireUser()
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, bodySchema)
    const definition = importTarget(input.target as (typeof IMPORT_TARGETS)[number]['key'])

    if (typeof input.docText === 'string') {
      const outcome = await applyNovelDocument(input.docText, {
        user,
        projectId,
        episodeId: input.episodeId ?? null,
      })
      await logActivity({
        user,
        action: 'create',
        entityType: 'import',
        entityId: definition.key,
        projectId,
        summary: `${user.name} 匯入了一份小說，${outcome.created} 章`,
      })
      return jsonOk({ ...outcome, issues: [] })
    }

    if (!input.sheet || !input.mapping) {
      throw ApiError.badRequest('缺少要匯入的內容')
    }

    const mapContext = await buildMapContext(projectId)
    const mapped = mapRows(
      { headers: input.sheet.headers, rows: input.sheet.rows, format: 'csv' },
      input.mapping,
      definition,
      mapContext
    )

    const outcome = await applyImport(definition.key, mapped, {
      user,
      projectId,
      episodeId: input.episodeId ?? null,
    })

    await logActivity({
      user,
      action: 'create',
      entityType: 'import',
      entityId: definition.key,
      projectId,
      summary: `${user.name} 匯入了 ${outcome.created} 筆${definition.label}`,
    })

    return jsonOk({
      ...outcome,
      /* 錯誤與警告一起回去——匯完才看到問題總比沒看到好。 */
      issues: mapped.issues.slice(0, 200),
    })
  }
)
