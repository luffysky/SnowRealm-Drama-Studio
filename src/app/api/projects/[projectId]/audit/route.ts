import { z } from 'zod'
import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { askWriter, auditEpisode, digestStory } from '@/lib/ai/story-audit'

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
  /**
   * 還留著的那幾條審核準則的索引（`AUDIT_RULES` 的位置）。
   *
   * 省略＝全部。畫面上勾掉一條的時候它要真的從提示詞裡消失——一個勾得動但沒
   * 有作用的核取方塊，比沒有核取方塊糟。
   */
  rules: z.array(z.number().int().min(0).max(13)).optional(),
  /** 有問題就是問答，沒有就是整理。 */
  question: z.string().trim().min(1).max(2000).optional(),
  /** 之前幾輪問答，由畫面那一端保存並帶回來。 */
  history: z
    .array(z.object({ question: z.string().max(2000), answer: z.string().max(20_000) }))
    .max(20)
    .optional(),
  /** 已經算好的整理，當材料用——省得模型再把十萬字讀一次。 */
  material: z.string().max(60_000).optional(),
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

    if (input.question) {
      const result = await askWriter({
        projectId,
        question: input.question,
        user,
        ...(input.history ? { history: input.history } : {}),
        ...(input.episodeId ? { episodeId: input.episodeId } : {}),
        ...(input.material ? { material: input.material } : {}),
        ...(input.rules ? { rules: input.rules } : {}),
      })
      return jsonOk({ ask: result })
    }

    if (input.episodeId) {
      const result = await auditEpisode({
        projectId,
        episodeId: input.episodeId,
        user,
        ...(input.rules ? { rules: input.rules } : {}),
      })
      return jsonOk({ episode: result })
    }

    const result = await digestStory({
      projectId,
      user,
      ...(input.rules ? { rules: input.rules } : {}),
    })
    return jsonOk({ digest: result })
  }
)
