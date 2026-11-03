import { ApiError, handle, jsonOk, parseJson, requireUser } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { saveChapterSchema } from '@/lib/validators'
import { chapterProjectId, saveChapter } from '@/lib/writing'

export const runtime = 'nodejs'

/**
 * Saves one chapter.
 *
 * Returns 409 when the document moved on since the editor was opened, so the
 * other member's paragraph is never silently overwritten.
 */
export const PATCH = handle(
  async (
    request: Request,
    context: { params: Promise<{ projectId: string; chapterId: string }> }
  ) => {
    const user = await requireUser()
    const { projectId, chapterId } = await context.params

    await requireProjectApi(projectId, user.id)
    if ((await chapterProjectId(chapterId)) !== projectId) {
      throw ApiError.notFound('找不到這個章節')
    }

    const input = await parseJson(request, saveChapterSchema)
    const result = await saveChapter({ chapterId, ...input, user })

    return jsonOk(result)
  }
)
