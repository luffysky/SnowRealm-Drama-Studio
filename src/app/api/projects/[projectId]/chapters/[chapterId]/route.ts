import { ApiError, handle, jsonOk, parseJson, requireUser } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { saveChapterSchema } from '@/lib/validators'
import { chapterProjectId, deleteChapter, saveChapter } from '@/lib/writing'
import { markSearchDirty } from '@/lib/search'

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

    // 內容變了，索引就落後了（只標記，不重建——見 markSearchDirty）

    await markSearchDirty(projectId)

    return jsonOk(result)
  }
)

/**
 * 刪除一個章節。
 *
 * The backup is not a separate step and not optional: `deleteChapter` appends
 * the whole document to 版本紀錄 in the same transaction, so the reply can say
 * which version to restore from.
 *
 * `?revision=` carries the same optimistic lock a save does. Deleting a
 * chapter out from under someone typing in it is the same accident as
 * overwriting their paragraph, and gets the same 409.
 */
export const DELETE = handle(
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

    /*
     * Checked for presence before it is converted.
     *
     * `Number(null)` is 0, which is a perfectly valid revision — so a request
     * that simply forgot the parameter used to sail past this guard and fail
     * the optimistic lock instead, coming back as 409「這一章剛剛被改過」.
     * That blames the other member for a missing query string.
     */
    const raw = new URL(request.url).searchParams.get('revision')
    if (raw === null) throw ApiError.badRequest('缺少 revision')

    const revision = Number(raw)
    if (!Number.isInteger(revision) || revision < 0) {
      throw ApiError.badRequest('revision 要是一個不小於 0 的整數')
    }

    const result = await deleteChapter({ chapterId, expectedRevision: revision, user })

    await markSearchDirty(projectId)

    return jsonOk(result)
  }
)
