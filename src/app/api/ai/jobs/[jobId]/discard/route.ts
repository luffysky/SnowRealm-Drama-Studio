import { handle, jsonOk, requirePermission } from '@/lib/api'
import { discardCandidate } from '@/lib/ai/jobs'

export const runtime = 'nodejs'

/**
 * 捨棄一份待確認的產出 (Z127-5).
 *
 * Separate from `/cancel`, which only applies to work still in flight. The
 * result payload is kept — see `discardCandidate`.
 */
export const POST = handle(
  async (_request: Request, context: { params: Promise<{ jobId: string }> }) => {
    const user = await requirePermission('ai.run')
    const { jobId } = await context.params

    const job = await discardCandidate({ user, jobId })
    return jsonOk({ job })
  }
)
