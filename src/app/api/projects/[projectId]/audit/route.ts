import { z } from 'zod'
import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { auditEpisode, digestStory } from '@/lib/ai/story-audit'

export const runtime = 'nodejs'

/**
 * 一次 300 秒，而不是預設值 (Z198).
 *
 * 這一條走 VIP 通道：模型跑完才回，所以請求的長度就是模型思考的長度。一集五
 * 千字、`effort: high` 的審稿要三十秒到一分多鐘，而預設的上限會在它還在想的
 * 時候把連線切掉——畫面上看到的是「失敗」，而帳已經付了。
 */
export const maxDuration = 300

const bodySchema = z.object({
  /** 給了就整理那一集；沒給就整理主線與人設。 */
  episodeId: z.string().uuid().optional(),
})

/**
 * 編劇助手：當場整理，當場回 (Z198).
 *
 * **不排佇列。** `ai_jobs` 的 worker 每天 03:00 跑一次，排下去的東西要等到隔
 * 天——而這份產出不寫回任何地方，它就是一份給人讀的整理，沒有東西需要人審核
 * 之後才落地。
 */
export const POST = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requirePermission('ai.run')
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, bodySchema)

    if (input.episodeId) {
      const result = await auditEpisode({ projectId, episodeId: input.episodeId, user })
      return jsonOk({ episode: result })
    }

    const result = await digestStory({ projectId, user })
    return jsonOk({ digest: result })
  }
)
