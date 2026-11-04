import { handle, jsonOk, parseJson, requireUser } from '@/lib/api'
import { assertOwnThread, titleFromFirstMessage } from '@/lib/assistant/threads'
import { readThreadMessage } from '@/lib/assistant/triggers'
import { listMessages, messagesSince, sendMessage } from '@/lib/chat'
import { chatSendSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 助理對話串裡的訊息 (Z100).
 *
 * The same `messages` table and the same helpers as the two-person thread —
 * the separation is which conversation row they hang off, not a second
 * implementation of history, attachments, recall and search.
 *
 *   ?before=<seq>   the page above; what scrolling up asks for
 *   ?since=<seq>    everything newer; used after a run
 *   ?q=<text>       search this thread
 */
export const GET = handle(
  async (request: Request, context: { params: Promise<{ threadId: string }> }) => {
    const user = await requireUser()
    const { threadId } = await context.params
    await assertOwnThread(threadId, user.id)

    const params = new URL(request.url).searchParams

    const since = params.get('since')
    if (since !== null) {
      const cursor = Number(since)
      return jsonOk({
        messages: await messagesSince(threadId, Number.isFinite(cursor) ? cursor : 0),
      })
    }

    const before = Number(params.get('before'))
    const limit = Number(params.get('limit'))

    return jsonOk({
      messages: await listMessages({
        conversationId: threadId,
        ...(Number.isFinite(before) && before > 0 ? { before } : {}),
        ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
        ...(params.get('q') ? { search: params.get('q') as string } : {}),
      }),
    })
  }
)

/**
 * Says something to the assistant.
 *
 * Returns before the model runs. A send has to come back in milliseconds so
 * the line appears on screen; the turn is a second request, because it takes
 * seconds and can be lost without losing what was typed.
 */
export const POST = handle(
  async (request: Request, context: { params: Promise<{ threadId: string }> }) => {
    const user = await requireUser()
    const { threadId } = await context.params
    await assertOwnThread(threadId, user.id)

    const input = await parseJson(request, chatSendSchema)

    const message = await sendMessage({
      conversationId: threadId,
      senderId: user.id,
      kind: input.kind,
      body: input.body,
      assetId: input.assetId ?? null,
      durationSec: input.durationSec ?? null,
      replyToId: input.replyToId ?? null,
    })

    /*
     * Tells the client whether a turn follows, and for a mistyped command
     * that it will be answered locally rather than by a model — so it can
     * show the right indicator instead of 「助理正在想」 for something that
     * never reaches one.
     */
    const intent = readThreadMessage(message.body)

    /*
     * Only a real request names the thread. A typo the assistant is about to
     * reject, or `/help`, is not what the thread turned out to be about —
     * and a thread permanently named after a mistyped command is a small
     * thing you cannot fix without renaming it by hand.
     */
    if (intent.kind === 'mention' || (intent.kind === 'command' && intent.command !== 'help')) {
      await titleFromFirstMessage(threadId, input.body)
    }

    return jsonOk({ message, intent: intent.kind }, { status: 201 })
  }
)
