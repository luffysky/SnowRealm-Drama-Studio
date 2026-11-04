import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { buildContext, estimateJob } from '@/lib/ai/jobs'
import { aiRunSchema } from '@/lib/validators'

/**
 * Token and cost estimate, shown on the 成本確認 tab before the user spends
 * anything. Runs no generation.
 */
export const POST = handle(async (request: Request) => {
  await requirePermission('ai.run')
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

  const estimate = await estimateJob({
    task: input.task,
    providerId: input.providerId ?? null,
    ...(input.model ? { model: input.model } : {}),
    candidates: input.candidates,
    ...(input.maxTokens ? { maxTokens: input.maxTokens } : {}),
    context,
  })

  return jsonOk({ estimate })
})
