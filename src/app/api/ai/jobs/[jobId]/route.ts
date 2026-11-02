import { ApiError, handle, jsonOk, requireUser } from '@/lib/api'
import { getJobWithAttempts } from '@/lib/ai/jobs'

export const runtime = 'nodejs'

/**
 * One job with its attempt history. This is the polling endpoint the UI uses
 * for progress — `job.progress` is written by the worker, so the client never
 * invents a completion percentage.
 */
export const GET = handle(
  async (_request: Request, context: { params: Promise<{ jobId: string }> }) => {
    await requireUser()
    const { jobId } = await context.params

    const found = await getJobWithAttempts(jobId)
    if (!found) throw ApiError.notFound('找不到該 AI 任務')

    return jsonOk(found)
  }
)
