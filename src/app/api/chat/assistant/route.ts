import { assertMember, openDirectConversation } from '@/lib/chat'
import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { ApiError } from '@/lib/api'
import { runAssistant } from '@/lib/assistant/run'
import { detectTrigger } from '@/lib/assistant/triggers'
import { assistantRunSchema } from '@/lib/validators'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { messages } from '@/db/schema'

export const runtime = 'nodejs'
/** A turn with tool rounds takes longer than the default. */
export const maxDuration = 60

/**
 * Runs one assistant turn (Z100).
 *
 * Called by the client after a message that triggered it, rather than inline
 * in the send: a send has to return in milliseconds so the message appears,
 * and a model turn takes seconds. The reply arrives over the same SSE channel
 * as any other message, so both screens get it with no special path.
 *
 * `ai.run` rather than `project.read`, because this spends money.
 */
export const POST = handle(async (request: Request) => {
  const user = await requirePermission('ai.run')
  const input = await parseJson(request, assistantRunSchema)

  const conversationId = input.conversationId ?? (await openDirectConversation(user.id))
  await assertMember(conversationId, user.id)

  const [message] = await db
    .select({ id: messages.id, body: messages.body, conversationId: messages.conversationId })
    .from(messages)
    .where(eq(messages.id, input.messageId))
    .limit(1)

  if (!message) throw ApiError.notFound('找不到那則訊息')
  if (message.conversationId !== conversationId) {
    throw ApiError.forbidden('那則訊息不在這個對話裡')
  }

  /*
   * Re-checked here, not trusted from the client. The trigger rule is what
   * keeps the assistant from reading a private conversation, so a client
   * asking it to run on an arbitrary message must not be able to bypass it.
   */
  const trigger = detectTrigger(message.body)
  if (!trigger) throw ApiError.badRequest('那則訊息沒有呼叫助理')

  const result = await runAssistant({
    conversationId,
    triggerMessageId: message.id,
    trigger,
    userId: user.id,
  })

  return jsonOk(result)
})
