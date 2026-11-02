import { handle, jsonOk, requirePermission } from '@/lib/api'
import { requestCancel } from '@/lib/ai/queue'

export const runtime = 'nodejs'

/**
 * Requests cancellation. A queued job is cancelled outright; a running one is
 * flagged and the worker honours it when the provider call returns.
 *
 * Cancelling does not guarantee the provider stops billing (spec v2 §6.6), so
 * any usage already incurred is still recorded against the job.
 */
export const POST = handle(
  async (_request: Request, context: { params: Promise<{ jobId: string }> }) => {
    await requirePermission('ai.run')
    const { jobId } = await context.params

    const job = await requestCancel(jobId)
    return jsonOk({ job })
  }
)
