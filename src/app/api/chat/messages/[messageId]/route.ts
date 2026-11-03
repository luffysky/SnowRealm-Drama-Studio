import { editMessage, recallMessage } from '@/lib/chat'
import { handle, jsonOk, parseJson, requireUser } from '@/lib/api'
import { chatEditSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/** 編輯訊息. Only the sender, only text, never a recalled one. */
export const PATCH = handle(
  async (request: Request, context: { params: Promise<{ messageId: string }> }) => {
    const user = await requireUser()
    const { messageId } = await context.params
    const input = await parseJson(request, chatEditSchema)

    return jsonOk({ message: await editMessage(messageId, user.id, input.body) })
  }
)

/**
 * 收回訊息.
 *
 * The row survives with its body cleared rather than being deleted — a hole in
 * the sequence would make a reconnecting client believe it had missed
 * something, and the other person may already have it on screen anyway.
 */
export const DELETE = handle(
  async (_request: Request, context: { params: Promise<{ messageId: string }> }) => {
    const user = await requireUser()
    const { messageId } = await context.params

    return jsonOk({ message: await recallMessage(messageId, user.id) })
  }
)
