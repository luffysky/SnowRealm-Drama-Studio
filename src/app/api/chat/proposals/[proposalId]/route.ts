import { handle, jsonOk, logActivity, parseJson, requireUser } from '@/lib/api'
import { applyProposal, rejectProposal } from '@/lib/assistant/proposals'
import { proposalDecisionSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 套用或拒絕一個提案 (Z100).
 *
 * Applying snapshots what it replaces into `versions` first — always, not as
 * an option. A model that can overwrite without a backup can delete someone's
 * writing with no way back.
 *
 * `force` is for when the target changed after the proposal was written. The
 * refusal names that, and the caller has to say explicitly that it has looked.
 */
export const POST = handle(
  async (request: Request, context: { params: Promise<{ proposalId: string }> }) => {
    const user = await requireUser()
    const { proposalId } = await context.params
    const input = await parseJson(request, proposalDecisionSchema)

    if (input.decision === 'reject') {
      return jsonOk({ proposal: await rejectProposal(proposalId, user) })
    }

    const proposal = await applyProposal(proposalId, user, { force: input.force ?? false })

    await logActivity({
      user,
      action: 'update',
      entityType: proposal.targetType,
      entityId: proposal.targetId,
      ...(proposal.backupVersionId ? { projectId: undefined } : {}),
      summary: `套用了 AI 助理對${proposal.field}的修改提案`,
    })

    return jsonOk({ proposal })
  }
)
