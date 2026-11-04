import { handle, jsonOk, logActivity, parseJson, requirePermission } from '@/lib/api'
import { enqueueBatch, planBatch, type BatchTask } from '@/lib/ai/batch'
import { requireProjectApi } from '@/lib/project-access'
import { aiBatchSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 批次生成 (Z127-3).
 *
 * `GET` plans, `POST` commits. Split on purpose: the dialog has to be able to
 * show which episodes are in, which are out and what the whole thing costs
 * **without** queueing anything, and the only honest way to produce that list
 * is the same code that will do the work.
 */

/** What the batch would do, without doing it. */
export const GET = handle(async (request: Request) => {
  const user = await requirePermission('ai.run')
  const params = new URL(request.url).searchParams

  const input = aiBatchSchema.parse({
    projectId: params.get('projectId'),
    task: params.get('task'),
    from: params.get('from'),
    to: params.get('to'),
  })

  // Route Handlers do not inherit the layout's check (docs/ROUTES.md §5).
  await requireProjectApi(input.projectId, user.id)

  const plan = await planBatch({
    projectId: input.projectId,
    task: input.task as BatchTask,
    from: input.from,
    to: input.to,
  })

  return jsonOk({ plan })
})

/** Queues it. Returns 202 with what was queued and what was skipped. */
export const POST = handle(async (request: Request) => {
  const user = await requirePermission('ai.run')
  const input = await parseJson(request, aiBatchSchema)

  await requireProjectApi(input.projectId, user.id)

  const result = await enqueueBatch({
    user,
    projectId: input.projectId,
    task: input.task as BatchTask,
    from: input.from,
    to: input.to,
    userInstruction: input.userInstruction,
    ...(input.model ? { model: input.model } : {}),
    providerId: input.providerId ?? null,
  })

  /*
   * Logged even when nothing was queued. 「我按了批次但什麼都沒發生」 is a
   * question the activity log should be able to answer, and a press that
   * skipped all fifteen episodes is exactly the press worth a record.
   */
  await logActivity({
    user,
    action: 'ai.batch',
    entityType: 'ai_job',
    entityId: result.queued[0]?.jobId ?? null,
    projectId: input.projectId,
    summary:
      `${user.name} 批次下了 ${input.task}：EP${pad(input.from)}–EP${pad(input.to)}，` +
      `排入 ${result.queued.length} 筆，跳過 ${result.skipped.length} 筆`,
  })

  return jsonOk(result, { status: 202 })
})

function pad(n: number): string {
  return String(n).padStart(3, '0')
}
