import { z } from 'zod'
import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { saveReport } from '@/lib/ai/writer-reports'
import { REPORT_KINDS } from '@/lib/ai/story-audit-view'

export const runtime = 'nodejs'

const bodySchema = z.object({
  kind: z.enum(REPORT_KINDS),
  episodeId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  /** 已經解析好的結果；形狀依 kind 而定。 */
  payload: z.unknown(),
  model: z.string().trim().max(120).optional(),
})

/** 把一份整理存進資料庫 (Z200)。 */
export const POST = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requirePermission('ai.run')
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, bodySchema)
    const report = await saveReport({ projectId, user, ...input })

    return jsonOk({ report }, { status: 201 })
  }
)
