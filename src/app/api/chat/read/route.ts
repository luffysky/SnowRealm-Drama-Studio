import { assertMember, markRead, openDirectConversation } from '@/lib/chat'
import { handle, jsonOk, parseJson, requireUser } from '@/lib/api'
import { chatReadSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/** Moves this member's read marker. Never backwards — see `markRead`. */
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  const input = await parseJson(request, chatReadSchema)

  const conversationId = input.conversationId ?? (await openDirectConversation(user.id))
  await assertMember(conversationId, user.id)
  await markRead(conversationId, user.id, input.seq)

  return jsonOk({ ok: true })
})
