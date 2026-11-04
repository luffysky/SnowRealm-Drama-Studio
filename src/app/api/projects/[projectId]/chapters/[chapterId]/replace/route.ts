import { ApiError, handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { markSearchDirty } from '@/lib/search'
import { requireProjectApi } from '@/lib/project-access'
import { chapterProjectId, replaceChapterContent } from '@/lib/writing'
import { replaceChapterSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 用 AI 的產出覆蓋一整章 (Z122).
 *
 * Separate from `PATCH`, which is the autosave: this one destroys what was
 * written on purpose, so it snapshots the document into 版本紀錄 first and
 * returns which version to restore from. The autosave must stay cheap and
 * must not write a version on every keystroke.
 *
 * `ai.run` rather than `document.write`, because the only caller is the AI
 * panel and the thing being authorised is 「讓機器的字取代我的字」.
 */
export const POST = handle(
  async (
    request: Request,
    context: { params: Promise<{ projectId: string; chapterId: string }> }
  ) => {
    const user = await requirePermission('ai.run')
    const { projectId, chapterId } = await context.params

    await requireProjectApi(projectId, user.id)
    if ((await chapterProjectId(chapterId)) !== projectId) {
      throw ApiError.notFound('找不到這個章節')
    }

    const input = await parseJson(request, replaceChapterSchema)

    const result = await replaceChapterContent({
      chapterId,
      content: input.content,
      expectedRevision: input.expectedRevision,
      user,
      label: input.label,
      aiJobId: input.aiJobId ?? null,
    })

    await markSearchDirty(projectId)

    return jsonOk(result)
  }
)
