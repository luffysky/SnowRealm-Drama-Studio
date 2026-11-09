import { db } from '@/db'
import { expenses } from '@/db/schema'
import { ApiError } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import { adapterForTask } from '@/lib/ai/jobs'
import { TASK_EFFORT } from '@/lib/ai/prompts'
import type { AiContext, AiRunResult, AiTaskKind } from '@/lib/ai/types'
import { assertWithinBudget, recordActual } from '@/lib/usage'

/**
 * VIP 通道：當場跑完，當場回結果（Z198）。
 *
 * ## 為什麼要有這一條
 *
 * 正常的 AI 任務走 `ai_jobs` 佇列：排進去 → worker 來撿 → 跑完 →
 * `AWAITING_REVIEW` → 人按「採用」。那一套是對的**當產出要寫回資料庫的時
 * 候**——改稿、生分鏡、轉劇本，每一樣都該有人看過才落地。
 *
 * 但編劇助手的產出**不寫回任何地方**，它就是一份給人讀的整理。而 worker 的
 * 排程是**每天 03:00 跑一次**，所以排下去的東西要等到隔天才看得到。暖寶說
 * 「整理給我看」的時候，她不是在說「明天早上給我看」。
 *
 * 所以這一條：直接呼叫適配器，等它回來，回傳。
 *
 * ## VIP 不等於不用付錢
 *
 * 繞過佇列很容易連著繞過兩件它順便在做的事，而那兩件都不能掉：
 *
 * - **預算閘門**。剛做好的上限如果 VIP 通道繞得過去，那它擋的就只是比較慢的
 *   那條路——而快的那條才是會被按很多次的。
 * - **記帳**。跑掉的 token 一樣要進 `usage_ledger` 與 `expenses`，不然成本中
 *   心會少報，而少報的帳比沒有帳更糟。
 *
 * 差別只在 `ai_job_id` 是空的：沒有工作列可以指。`description` 會寫明它走的
 * 是這一條，不然日後對帳的人會以為有一筆任務不見了。
 */

export type VipResult = {
  text: string
  model: string
  costUsd: number | null
  inputTokens: number
  outputTokens: number
}

export async function runNow(input: {
  task: AiTaskKind
  context: AiContext
  projectId: string
  episodeId?: string | null
  user: SessionUser
  /** 省略就用這個任務的預設深度（`TASK_EFFORT`）。 */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  maxTokens?: number
  /** 記帳時寫在摘要裡，讓人看得出這一筆是誰花的。 */
  label: string
}): Promise<VipResult> {
  const resolved = await adapterForTask(input.task)
  if (!resolved) {
    throw ApiError.notConfigured(
      '還沒有可用的 AI 供應商。到「系統設定 → AI 供應商」加一組金鑰之後再試。'
    )
  }

  /*
   * 預算先擋，而且是在呼叫**之前**。
   *
   * 這裡估不出金額（token 數要跑完才知道），所以送 0 進去——那仍然會擋下「已
   * 經超過上限」的情況，擋不住「這一次會剛好超過」。佇列那條路有估算可以用，
   * 這條沒有，而我不想憑空編一個估算值去餵一個會擋人的閘門。
   */
  await assertWithinBudget({
    projectId: input.projectId,
    additionalUsd: 0,
    category: 'AI_API',
  })

  const result = await resolved.adapter.run({
    task: input.task,
    context: input.context,
    effort: input.effort ?? TASK_EFFORT[input.task],
    ...(input.maxTokens ? { maxTokens: input.maxTokens } : {}),
  })

  const text = result.candidates[0]?.content ?? ''
  if (!text.trim()) {
    throw new ApiError(502, '模型回了空的內容', 'empty_completion')
  }

  await recordSpend(input.projectId, input.episodeId ?? null, input.label, result, input.user)

  return {
    text,
    model: result.model,
    costUsd: result.usage.costUsd,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  }
}

async function recordSpend(
  projectId: string,
  episodeId: string | null,
  label: string,
  result: AiRunResult,
  user: SessionUser
): Promise<void> {
  const costUsd = result.usage.costUsd
  if (costUsd === null || costUsd <= 0) return

  const description = `AI ${label}（${result.model}・直接執行）`

  await recordActual({
    projectId,
    episodeId,
    source: 'AI_JOB',
    // 沒有工作列可以指——這一筆不是任何一個 `ai_jobs` 的結算。
    refId: null,
    description,
    unit: 'tokens',
    quantity: result.usage.inputTokens + result.usage.outputTokens,
    amountUsd: costUsd,
  })

  await db.insert(expenses).values({
    projectId,
    episodeId,
    category: 'AI_API',
    description,
    amount: costUsd.toFixed(4),
    currency: 'USD',
    baseCurrency: 'USD',
    exchangeRate: '1',
    createdById: user.id,
  })
}
