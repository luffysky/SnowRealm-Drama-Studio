import { db } from '@/db'
import { expenses } from '@/db/schema'
import { ApiError } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import { adapterForTask } from '@/lib/ai/jobs'
import { TASK_EFFORT } from '@/lib/ai/prompts'
import { AiAdapterError, type AiContext, type AiRunResult, type AiTaskKind } from '@/lib/ai/types'
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

  let result: AiRunResult
  try {
    result = await resolved.adapter.run({
      task: input.task,
      context: input.context,
      effort: input.effort ?? TASK_EFFORT[input.task],
      ...(input.maxTokens ? { maxTokens: input.maxTokens } : {}),
    })
  } catch (cause) {
    // 供應商說得出原因的時候，不要把它換成「伺服器發生錯誤」。見下面。
    throw adapterErrorToApi(cause)
  }

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

/**
 * 把適配器的錯誤換成一個說得出話的 API 錯誤（Z201）。
 *
 * 排佇列那條路上，失敗會留在 `ai_jobs` 上、顯示在 AI 製片中心，連供應商回的那
 * 句話一起。**VIP 通道沒有那張工作列**，所以不翻譯的話它會從 `handle()` 掉出
 * 去變成一個通用的 500：
 *
 *     伺服器發生錯誤
 *
 * 而供應商實際說的是：
 *
 *     Your credit balance is too low to access the Anthropic API.
 *
 * 第二句話是一分鐘能解決的事，第一句話是一個下午。這個翻譯今天真的省到我自
 * 己——我先以為是剛寫的判定那條路壞了。
 *
 * 用 **502** 不是 500：上游拒絕了，不是我們這裡爆炸。而 `retryable` 的那幾種
 * （逾時、限流）用 **503**，讓呼叫端分得出「再試一次可能會過」跟「再試幾次都
 * 一樣」。
 */
export function adapterErrorToApi(cause: unknown): Error {
  if (!(cause instanceof AiAdapterError)) {
    return cause instanceof Error ? cause : new Error(String(cause))
  }

  /*
   * 訊息原樣帶出去，但是截短。
   *
   * 供應商的錯誤訊息偶爾會把整個請求回放一遍，而那裡面有這部作品的正文——一個
   * 錯誤提示不該變成一次外洩。兩百字夠說完是什麼問題了。
   */
  const detail = cause.message.slice(0, 200)
  const hint = hintFor(cause.message)

  return new ApiError(
    cause.retryable ? 503 : 502,
    hint ? `${hint}（供應商原話：${detail}）` : `AI 供應商拒絕了這次請求：${detail}`,
    `provider_${cause.code}`
  )
}

/**
 * 幾種常見而且**有明確動作**的失敗，加一句中文。
 *
 * 供應商回的是英文，而這個工作室有一半的人不會想讀一段英文錯誤訊息去猜自己該
 * 做什麼。原話照樣附在後面——翻譯是方便，不是取代：真的要查的時候，原話才是能
 * 拿去搜尋的那一個。
 *
 * **只列動作明確的那幾種。** 把每一種錯誤都翻一遍，等於多養一本會過期的對照
 * 表，而大部分錯誤翻成中文也還是不知道要做什麼。
 */
function hintFor(message: string): string | null {
  const text = message.toLowerCase()

  if (text.includes('credit balance') || text.includes('insufficient_quota')) {
    return 'AI 供應商的額度用完了。到供應商後台加值之後再試一次'
  }
  if (text.includes('rate limit') || text.includes('429')) {
    return '被供應商限流了，等幾分鐘再試'
  }
  if (text.includes('invalid x-api-key') || text.includes('authentication')) {
    return 'AI 金鑰不對或已經失效，到「系統設定 → AI 供應商」換一把'
  }
  if (text.includes('overloaded')) {
    return '供應商現在滿載，等一下再試'
  }
  return null
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
