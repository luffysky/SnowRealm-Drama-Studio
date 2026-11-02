'use client'

import { apiFetch, readApiError } from '@/lib/client-fetch'

/**
 * Browser-side helpers for the AI queue.
 *
 * On the Vercel Hobby plan cron fires at most once a day, so enqueueing alone
 * would leave a job sitting for hours. `submitAiJob` therefore enqueues and
 * then nudges the worker, which is what makes generation feel immediate.
 *
 * The nudge is best-effort: if it fails the job is still safely queued and the
 * nightly sweep will pick it up. That is why a failed nudge never surfaces as
 * an error — the work is not lost, only delayed.
 */

export type AiJobSubmission = {
  task: string
  projectId?: string | null
  episodeId?: string | null
  userInstruction?: string
  sourceText?: string
  candidates?: number
  targetType?: string
  targetId?: string | null
  /** Resubmitting the same key returns the existing job instead of paying twice. */
  idempotencyKey?: string
}

export type AiJob = {
  id: string
  status: string
  progress: number
  progressNote: string
  result?: unknown
  errorMessage?: string
}

export async function submitAiJob(
  input: AiJobSubmission
): Promise<{ job: AiJob; deduplicated: boolean }> {
  const response = await apiFetch('/api/ai/jobs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(input.idempotencyKey ? { 'idempotency-key': input.idempotencyKey } : {}),
    },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    throw new Error(await readApiError(response))
  }

  const body = (await response.json()) as { job: AiJob; deduplicated: boolean }

  // Start the work now rather than at the nightly sweep.
  if (!body.deduplicated) void nudgeWorker()

  return body
}

/**
 * Asks the worker to pick up due jobs. Authenticated by the caller's session.
 * Swallows failures by design — see the note at the top of this file.
 */
export async function nudgeWorker(limit = 1): Promise<void> {
  try {
    await apiFetch(`/api/ai/worker?limit=${limit}`, { method: 'POST' })
  } catch {
    /* queued regardless; the nightly cron is the backstop */
  }
}

/** Polls one job until it stops moving. Progress comes from the server only. */
export async function pollAiJob(
  jobId: string,
  onUpdate: (job: AiJob) => void,
  options: { intervalMs?: number; signal?: AbortSignal } = {}
): Promise<AiJob> {
  const interval = options.intervalMs ?? 2000
  const terminal = new Set(['AWAITING_REVIEW', 'SUCCEEDED', 'FAILED', 'CANCELLED'])

  for (;;) {
    if (options.signal?.aborted) throw new Error('已取消輪詢')

    const response = await apiFetch(`/api/ai/jobs/${jobId}`)
    if (!response.ok) throw new Error(await readApiError(response))

    const { job } = (await response.json()) as { job: AiJob }
    onUpdate(job)

    if (terminal.has(job.status)) return job

    // A job still QUEUED means no worker has claimed it — nudge again, since
    // on Hobby there is no frequent cron to do it for us.
    if (job.status === 'QUEUED') void nudgeWorker()

    await new Promise((resolve) => setTimeout(resolve, interval))
  }
}
