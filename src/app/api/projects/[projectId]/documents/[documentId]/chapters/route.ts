import { handle, jsonOk, logActivity, parseJson, requireUser } from '@/lib/api'
import { ApiError } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { createChapter, documentBelongsToProject } from '@/lib/writing'
import { createChapterSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/** Adds a chapter to an episode's novel. */
export const POST = handle(
  async (
    request: Request,
    context: { params: Promise<{ projectId: string; documentId: string }> }
  ) => {
    const user = await requireUser()
    const { projectId, documentId } = await context.params

    // Route Handlers do not inherit the layout's check (docs/ROUTES.md §5).
    await requireProjectApi(projectId, user.id)
    if (!(await documentBelongsToProject(documentId, projectId))) {
      throw ApiError.notFound('找不到這份文件')
    }

    const input = await parseJson(request, createChapterSchema)
    const { chapter, lockRevision } = await createChapter({
      documentId,
      title: input.title,
      user,
    })

    await logActivity({
      user,
      action: 'create',
      entityType: 'chapter',
      entityId: chapter.id,
      projectId,
      summary: `${user.name} 新增章節「${chapter.title || '未命名'}」`,
    })

    return jsonOk({ chapter, lockRevision }, { status: 201 })
  }
)

