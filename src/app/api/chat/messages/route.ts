import {
  assertMember,
  listMessages,
  messagesSince,
  openDirectConversation,
  sendMessage,
} from '@/lib/chat'
import { handle, jsonOk, parseJson, requireUser } from '@/lib/api'
import { detectTrigger } from '@/lib/assistant/triggers'
import { chatSendSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * History, search, and the polling fallback — one route, because they are the
 * same question with different bounds.
 *
 *   ?since=<seq>     everything newer; what the fallback asks for
 *   ?before=<seq>    the page above; what scrolling up asks for
 *   ?q=<text>        search the thread
 */
export const GET = handle(async (request: Request) => {
  const user = await requireUser()
  const params = new URL(request.url).searchParams

  const conversationId =
    params.get('conversation') ?? (await openDirectConversation(user.id))
  await assertMember(conversationId, user.id)

  const since = params.get('since')
  if (since !== null) {
    const cursor = Number(since)
    // `changedAfter` carries recalls and edits, which never move `seq`.
    const changedAfter = params.get('changedAfter')
    const changed = changedAfter ? new Date(changedAfter) : undefined

    return jsonOk({
      conversationId,
      at: new Date().toISOString(),
      messages: await messagesSince(
        conversationId,
        Number.isFinite(cursor) ? cursor : 0,
        changed && !Number.isNaN(changed.getTime()) ? changed : undefined
      ),
    })
  }

  const before = Number(params.get('before'))
  const limit = Number(params.get('limit'))

  return jsonOk({
    conversationId,
    messages: await listMessages({
      conversationId,
      ...(Number.isFinite(before) && before > 0 ? { before } : {}),
      ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
      ...(params.get('q') ? { search: params.get('q') as string } : {}),
    }),
  })
})

export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  const input = await parseJson(request, chatSendSchema)

  const conversationId = input.conversationId ?? (await openDirectConversation(user.id))
  await assertMember(conversationId, user.id)

  const message = await sendMessage({
    conversationId,
    senderId: user.id,
    kind: input.kind,
    body: input.body,
    assetId: input.assetId ?? null,
    durationSec: input.durationSec ?? null,
    replyToId: input.replyToId ?? null,
  })

  /*
   * Tells the client to start a turn. The run itself is a separate request:
   * a send must return in milliseconds so the message appears, and a model
   * turn takes seconds.
   */
  const trigger = detectTrigger(message.body)

  return jsonOk({ message, assistantTriggered: Boolean(trigger) }, { status: 201 })
})
