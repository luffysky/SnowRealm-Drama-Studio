import { handle, jsonOk, requirePermission } from '@/lib/api'
import { requeueJob } from '@/lib/ai/queue'

export const runtime = 'nodejs'

/**
 * Re-queues a failed job. The same row is reused, so its idempotency key still
 * holds and the attempt history stays intact (spec v2 §6.6「重試不得盲目重複扣費」).
 */
export const POST = handle(
  async (_request: Request, context: { params: Promise<{ jobId: string }> }) => {
    await requirePermission('ai.run')
    const { jobId } = await context.params

    const job = await requeueJob(jobId)
    return jsonOk({ job })
  }
)
