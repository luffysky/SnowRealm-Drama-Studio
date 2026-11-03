import { assertMember, openDirectConversation, startCall } from '@/lib/chat'
import { handle, jsonOk, parseJson, requireUser } from '@/lib/api'
import { callStartSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/** 撥號. The browsers negotiate; this only makes the other phone ring. */
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  const input = await parseJson(request, callStartSchema)

  const conversationId = input.conversationId ?? (await openDirectConversation(user.id))
  await assertMember(conversationId, user.id)

  const call = await startCall({ conversationId, callerId: user.id, video: input.video })

  return jsonOk({ call }, { status: 201 })
})
