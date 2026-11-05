import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { setReviewNoteState } from '@/lib/reviews'
import { reviewNoteStateSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 把一則審稿意見標成已處理，或重新打開 (Z41).
 *
 * 沒有 DELETE：一則「這裡的動機交代不夠」就算處理完了，也還是這份內容為什麼
 * 改成現在這樣的理由。
 */
export const PATCH = handle(
  async (
    request: Request,
    context: { params: Promise<{ projectId: string; noteId: string }> }
  ) => {
    const user = await requirePermission('document.write')
    const { projectId, noteId } = await context.params
    await requireProjectApi(projectId, user.id)

    const { state } = await parseJson(request, reviewNoteStateSchema)
    await setReviewNoteState({ projectId, noteId, state, user })

    return jsonOk({ ok: true })
  }
)
