import { ApiError, handle, jsonOk, logActivity, parseJson, requireUser } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { snapshotVersionSchema } from '@/lib/validators'
import { documentBelongsToProject, snapshotDocument } from '@/lib/writing'

export const runtime = 'nodejs'

/** Keeps an immutable snapshot of the document as it stands. */
export const POST = handle(
  async (
    request: Request,
    context: { params: Promise<{ projectId: string; documentId: string }> }
  ) => {
    const user = await requireUser()
    const { projectId, documentId } = await context.params

    await requireProjectApi(projectId, user.id)
    if (!(await documentBelongsToProject(documentId, projectId))) {
      throw ApiError.notFound('找不到這份文件')
    }

    const input = await parseJson(request, snapshotVersionSchema)
    const result = await snapshotDocument({ documentId, label: input.label, user })

    await logActivity({
      user,
      action: 'version',
      entityType: 'document',
      entityId: documentId,
      projectId,
      summary: `${user.name} 儲存了版本 v${result.version}`,
    })

    return jsonOk(result, { status: 201 })
  }
)
