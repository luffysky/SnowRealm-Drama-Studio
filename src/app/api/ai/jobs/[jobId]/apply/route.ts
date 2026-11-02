import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { applyCandidate } from '@/lib/ai/jobs'
import { aiApplySchema } from '@/lib/validators'

/**
 * The single path from AI output into real data. Requires `acknowledge: true`,
 * and snapshots the existing content as a new version first, so applying a
 * candidate is always reversible.
 */
export const POST = handle(
  async (request: Request, context: { params: Promise<{ jobId: string }> }) => {
    const user = await requirePermission('ai.run')
    const { jobId } = await context.params

    const input = await parseJson(request, aiApplySchema.omit({ jobId: true }))

    const result = await applyCandidate({
      user,
      jobId,
      candidateIndex: input.candidateIndex,
    })

    return jsonOk(result)
  }
)
