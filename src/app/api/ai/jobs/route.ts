import crypto from 'node:crypto'
import { handle, jsonOk, parseJson, requirePermission, requireUser } from '@/lib/api'
import { buildContext, estimateJob, listJobs } from '@/lib/ai/jobs'
import { enqueueJob } from '@/lib/ai/queue'
import type { AiJobStatusValue } from '@/lib/constants'
import { aiRunSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/** The 全域 AI 任務佇列 feed (spec v2 §80). */
export const GET = handle(async (request: Request) => {
  await requireUser()

  const params = new URL(request.url).searchParams
  const status = params.get('status') as AiJobStatusValue | null

  const jobs = await listJobs({
    projectId: params.get('projectId'),
    ...(status ? { status } : {}),
    limit: Number(params.get('limit') ?? 50),
  })

  return jsonOk({ jobs })
})

/**
 * Enqueues an AI job and returns immediately with 202.
 *
 * It does **not** run the model: that happens in the worker, so a long
 * generation cannot exceed this function's time limit. The client polls
 * `/api/ai/jobs/[jobId]` for progress — the percentage comes from the job row,
 * never from a frontend timer (spec v2 §7).
 */
export const POST = handle(async (request: Request) => {
  const user = await requirePermission('ai.run')
  const input = await parseJson(request, aiRunSchema)

  const context = await buildContext({
    projectId: input.projectId ?? null,
    episodeId: input.episodeId ?? null,
    novelEpisodeId: input.novelEpisodeId ?? null,
    ...(input.sourceText ? { sourceText: input.sourceText } : {}),
    userInstruction: input.userInstruction,
    includeWorld: input.includeWorld,
    includeCharacters: input.includeCharacters,
  })

  // Record the estimate alongside the job so the cost dialog can compare it
  // against what the run actually cost.
  let estimatedCostUsd: number | null = null
  try {
    const estimate = await estimateJob({
      task: input.task,
      providerId: input.providerId ?? null,
      ...(input.model ? { model: input.model } : {}),
      candidates: input.candidates,
      ...(input.maxTokens ? { maxTokens: input.maxTokens } : {}),
      context,
    })
    estimatedCostUsd = estimate.estimatedCostUsd
  } catch {
    // An estimate is informational; a provider that cannot count tokens must
    // not block the job from being queued.
  }

  const idempotencyKey =
    request.headers.get('idempotency-key') ?? input.idempotencyKey ?? crypto.randomUUID()

  const { job, deduplicated } = await enqueueJob({
    user,
    task: input.task,
    context,
    projectId: input.projectId ?? null,
    episodeId: input.episodeId ?? null,
    providerId: input.providerId ?? null,
    ...(input.model ? { model: input.model } : {}),
    candidates: input.candidates,
    ...(input.effort ? { effort: input.effort } : {}),
    ...(input.maxTokens ? { maxTokens: input.maxTokens } : {}),
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    idempotencyKey,
    estimatedCostUsd,
  })

  return jsonOk({ job, deduplicated }, { status: deduplicated ? 200 : 202 })
})
