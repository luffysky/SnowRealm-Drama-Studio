import { handle, jsonOk, logActivity, parseJson, requireUser } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { createChapterInEpisode } from '@/lib/writing'
import { createChapterSchema } from '@/lib/validators'
import { markSearchDirty } from '@/lib/search'

export const runtime = 'nodejs'

/**
 * 在某一集的小說裡新增章節 (Z128).
 *
 * Keyed by episode rather than document, which is what lets 「下一集」 work:
 * the next episode may have no 小說 document yet, and the editor has no way to
 * learn its id without one existing. The document is opened or created here.
 *
 * The document-keyed route next door stays — it is the right shape for adding
 * to the document already open, and it is what the editor still uses for
 * 「在這一集」.
 */
export const POST = handle(
  async (
    request: Request,
    context: { params: Promise<{ projectId: string; episodeId: string }> }
  ) => {
    const user = await requireUser()
    const { projectId, episodeId } = await context.params

    // Route Handlers do not inherit the layout's check (docs/ROUTES.md §5).
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, createChapterSchema)
    const created = await createChapterInEpisode({
      projectId,
      episodeId,
      title: input.title,
      user,
    })

    await logActivity({
      user,
      action: 'create',
      entityType: 'chapter',
      entityId: created.chapter.id,
      projectId,
      summary:
        `${user.name} 在 EP${String(created.episodeNumber).padStart(3, '0')} ` +
        `新增章節「${created.chapter.title || '未命名'}」`,
    })

    // 內容變了，索引就落後了（只標記，不重建——見 markSearchDirty）
    await markSearchDirty(projectId)

    return jsonOk(created, { status: 201 })
  }
)
