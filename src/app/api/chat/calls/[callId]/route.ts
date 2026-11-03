import { setCallState } from '@/lib/chat'
import { handle, jsonOk, parseJson, requireUser } from '@/lib/api'
import { callStateSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/** 接聽／掛斷／拒接. The finished call writes its own line into the thread. */
export const PATCH = handle(
  async (request: Request, context: { params: Promise<{ callId: string }> }) => {
    const user = await requireUser()
    const { callId } = await context.params
    const input = await parseJson(request, callStateSchema)

    return jsonOk({ call: await setCallState(callId, user.id, input.state) })
  }
)
