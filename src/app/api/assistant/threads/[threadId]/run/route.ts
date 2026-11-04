import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { messages } from '@/db/schema'
import { ApiError, handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { helpText, runAssistant } from '@/lib/assistant/run'
import { assertOwnThread } from '@/lib/assistant/threads'
import { SLASH_COMMANDS, readThreadMessage } from '@/lib/assistant/triggers'
import { sendMessage } from '@/lib/chat'
import { assistantRunSchema } from '@/lib/validators'

export const runtime = 'nodejs'
/** A turn with tool rounds takes longer than the default. */
export const maxDuration = 60

/**
 * Runs one assistant turn (Z100).
 *
 * `ai.run` rather than `project.read`, because this spends money.
 *
 * Scoped by `assertOwnThread`, which is stricter than membership: it refuses
 * the two-person conversation outright. A client that passed that id would
 * otherwise send their private thread to a model, which is the one thing the
 * separation exists to make impossible.
 */
export const POST = handle(
  async (request: Request, context: { params: Promise<{ threadId: string }> }) => {
    const user = await requirePermission('ai.run')
    const { threadId } = await context.params
    await assertOwnThread(threadId, user.id)

    const input = await parseJson(request, assistantRunSchema)

    const [message] = await db
      .select({ id: messages.id, body: messages.body, conversationId: messages.conversationId })
      .from(messages)
      .where(eq(messages.id, input.messageId))
      .limit(1)

    if (!message) throw ApiError.notFound('找不到那則訊息')
    if (message.conversationId !== threadId) {
      throw ApiError.forbidden('那則訊息不在這條對話串裡')
    }

    const intent = readThreadMessage(message.body)

    /*
     * Answered here, for free. A typo in a command name should not cost a
     * model turn to discover, and an empty line should not cost anything at
     * all.
     */
    if (intent.kind === 'empty') {
      throw ApiError.badRequest('沒有內容')
    }

    /*
     * `/help` is a constant, so it is answered here rather than inside
     * `runAssistant`. It used to return early from there, which meant the
     * route reported `spent: true` for a turn that never reached a model —
     * the flag the client uses to decide whether to show a cost was simply
     * wrong for it.
     */
    if (intent.kind === 'command' && intent.command === 'help') {
      const sent = await sendMessage({
        conversationId: threadId,
        senderId: null,
        body: helpText(),
        fromAssistant: true,
        repliesToId: message.id,
      })
      return jsonOk({ messageId: sent.id, proposals: 0, costUsd: 0, spent: false })
    }

    if (intent.kind === 'unknown-command') {
      const names = SLASH_COMMANDS.map((command) => command.label).join('、')
      const sent = await sendMessage({
        conversationId: threadId,
        senderId: null,
        body: `沒有 ${intent.typed} 這個指令。有的是：${names}\n\n不用指令直接說也可以。`,
        fromAssistant: true,
        repliesToId: message.id,
      })
      return jsonOk({ messageId: sent.id, proposals: 0, costUsd: 0, spent: false })
    }

    const result = await runAssistant({
      conversationId: threadId,
      triggerMessageId: message.id,
      trigger: intent,
      userId: user.id,
    })

    return jsonOk({ ...result, spent: true })
  }
)
