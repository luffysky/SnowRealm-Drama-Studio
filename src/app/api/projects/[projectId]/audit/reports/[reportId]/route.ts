import { handle, jsonOk, requirePermission } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { deleteReport } from '@/lib/ai/writer-reports'

export const runtime = 'nodejs'

/** 刪掉一份存起來的整理 (Z200)。 */
export const DELETE = handle(
  async (
    _request: Request,
    context: { params: Promise<{ projectId: string; reportId: string }> }
  ) => {
    const user = await requirePermission('ai.run')
    const { projectId, reportId } = await context.params
    await requireProjectApi(projectId, user.id)

    await deleteReport({ projectId, reportId, user })

    return jsonOk({ ok: true })
  }
)
