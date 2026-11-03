import { pushSignal } from '@/lib/chat'
import { handle, jsonOk, parseJson, requireUser } from '@/lib/api'
import { callSignalSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * One SDP or ICE payload for the other side.
 *
 * The payload is opaque here — the server stores and forwards it without
 * parsing. It is the browsers' handshake, and anything this end understood
 * about it would be a thing to keep in step with two WebRTC implementations.
 */
export const POST = handle(
  async (request: Request, context: { params: Promise<{ callId: string }> }) => {
    const user = await requireUser()
    const { callId } = await context.params
    const input = await parseJson(request, callSignalSchema)

    if (input.callId !== callId) {
      const { ApiError } = await import('@/lib/api')
      throw ApiError.badRequest('通話識別碼不一致')
    }

    await pushSignal({
      callId,
      fromUserId: user.id,
      kind: input.kind,
      payload: input.payload,
    })

    return jsonOk({ ok: true })
  }
)
