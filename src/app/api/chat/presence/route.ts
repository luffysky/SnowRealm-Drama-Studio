import { assertMember, heartbeat, openDirectConversation } from '@/lib/chat'
import { handle, jsonOk, parseJson, requireUser } from '@/lib/api'
import { chatPresenceSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 上線狀態與「輸入中」.
 *
 * A heartbeat that overwrites one row, rather than an append-only log: nobody
 * needs yesterday's presence, and a log of it would grow forever for
 * information worthless a minute later.
 */
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  const input = await parseJson(request, chatPresenceSchema)

  let typingInId: string | null = null
  if (input.typing) {
    typingInId = input.conversationId ?? (await openDirectConversation(user.id))
    await assertMember(typingInId, user.id)
  }

  await heartbeat({ userId: user.id, typingInId })

  return jsonOk({ ok: true })
})
