import { handle, jsonOk, parseJson, requireUser } from '@/lib/api'
import { deleteThread, renameThread } from '@/lib/assistant/threads'
import { assistantThreadPatchSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/** Renames a thread. */
export const PATCH = handle(
  async (request: Request, context: { params: Promise<{ threadId: string }> }) => {
    const user = await requireUser()
    const { threadId } = await context.params
    const input = await parseJson(request, assistantThreadPatchSchema)

    return jsonOk({ thread: await renameThread(threadId, user.id, input.title) })
  }
)

/**
 * Deletes a thread and everything said in it.
 *
 * An applied proposal is already an edit plus a `versions` snapshot, so
 * deleting the conversation does not take back the work or its backup — only
 * the record of asking.
 */
export const DELETE = handle(
  async (_request: Request, context: { params: Promise<{ threadId: string }> }) => {
    const user = await requireUser()
    const { threadId } = await context.params

    await deleteThread(threadId, user.id)
    return jsonOk({ ok: true })
  }
)
