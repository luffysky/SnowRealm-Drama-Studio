import { resolveMaxTokens } from './budget'
import { buildUserMessage, STRUCTURED_TASKS, SYSTEM_PROMPT } from './prompts'
import {
  AiAdapterError,
  type AiAdapter,
  type AiEstimate,
  type AiProviderStatus,
  type AiRunRequest,
  type AiRunResult,
  type AiTaskKind,
} from './types'

/**
 * 一個適配器，接得上七家 (Z151).
 *
 * GPT、Gemini、DeepSeek、Kimi、千問、GLM、OpenRouter 全部提供 OpenAI 相容的
 * `/chat/completions`。差別只在 base URL、金鑰與模型名，而那三樣
 * `ai_providers` 本來就有欄位——所以不需要七個適配器。
 *
 * 用原生 `fetch` 而不是 OpenAI 的 SDK：這裡只用到一個端點，而多一個相依
 * 套件就是多一個要跟著升級、而且會把七家的差異藏在它自己假設裡的東西。
 *
 * ## 三個「相容」沒有那麼相容的地方
 *
 *  1. **`n`（一次要幾個候選）不是每家都收。** 送過去被拒的話整個請求 400，
 *     而我們要的只是兩個候選。所以改成**連續叫兩次**——慢一點，但不會因為
 *     換了一家廠商就整個任務掛掉。
 *  2. **`response_format` 也不是每家都收。** 結構化任務會先帶著它送；被拒
 *     就拿掉重送一次，並在提示詞裡要求只回 JSON。寧可多一次往返，不要讓
 *     「這家不支援這個參數」變成「這個任務不能用」。
 *  3. **`max_tokens` vs `max_completion_tokens`。** 新的 OpenAI 推理模型只收
 *     後者。同樣的處理：先送通用的那個，被拒就換。
 *
 * ## 價格不會編
 *
 * 成本只在**系統設定的模型單價表裡查得到這個模型**時才算得出來；查不到就
 * 回 `null`。七家各自的牌價會變，而一個寫死在程式裡的數字會讓成本中心
 * 安靜地錯——規格 23 要的是「金額不可虛構」。
 */

const SUPPORTED_TASKS: readonly AiTaskKind[] = [
  'PROJECT_PLAN',
  'OUTLINE_GENERATE',
  'OUTLINE_REVIEW',
  'NOVEL_CONTINUE',
  'NOVEL_REWRITE',
  'NOVEL_POLISH',
  'NOVEL_REVIEW',
  'NOVEL_TO_SCRIPT',
  'SCRIPT_ANALYZE',
  'WORLD_GENERATE',
  'WORLD_CONSISTENCY',
  'CHARACTER_DESIGN',
  'STORYBOARD_GENERATE',
  'ASSET_GENERATE',
  'TASK_SUGGEST',
  'DIALOGUE_ATTRIBUTE',
]

/**
 * 中文大約一字一 token，英文大約四個字元一 token。
 *
 * 這七家沒有一個提供可在本機跑的分詞器，所以估算只能用字元數推。**它是
 * 估算，不是計數**——介面上顯示的時候要說清楚，而真正的用量一律以回應裡的
 * `usage` 為準。
 */
function approximateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[㐀-鿿豈-﫿]/g) ?? []).length
  const rest = text.length - cjk
  return Math.ceil(cjk + rest / 4)
}

export type OpenAiCompatibleConfig = {
  /** 解密過的金鑰，或 null 代表改讀環境變數。 */
  apiKey?: string | null
  envVarName?: string
  baseUrl: string
  defaultModel?: string
  label: string
  enabled?: boolean
  /** 從系統設定來的模型單價，每百萬 token 美金。 */
  pricing?: Record<string, { input: number; output: number; cacheRead: number }>
}

type ChatResponse = {
  choices?: { message?: { content?: string | null } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string; type?: string }
}

export function createOpenAiCompatibleAdapter(config: OpenAiCompatibleConfig): AiAdapter {
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, '')
  const key = config.apiKey || (config.envVarName ? process.env[config.envVarName] : '') || ''
  const model = config.defaultModel || ''

  const endpoint = `${baseUrl}/chat/completions`

  /** 一次請求。`variant` 控制上面那三個相容性退讓。 */
  async function chat(input: {
    model: string
    system: string
    user: string
    maxTokens: number
    json: boolean
    useCompletionTokens: boolean
  }): Promise<{ response: Response; body: ChatResponse | null; text: string }> {
    const payload: Record<string, unknown> = {
      model: input.model,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
    }

    payload[input.useCompletionTokens ? 'max_completion_tokens' : 'max_tokens'] = input.maxTokens
    if (input.json) payload.response_format = { type: 'json_object' }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    })

    const text = await response.text()
    let body: ChatResponse | null = null
    try {
      body = JSON.parse(text) as ChatResponse
    } catch {
      body = null
    }

    return { response, body, text }
  }

  /**
   * 送一次，遇到「這個參數我不收」就退讓後重送。
   *
   * 退讓是有順序的：先拿掉 `response_format`（只影響格式），再換
   * `max_completion_tokens`（只影響參數名）。兩個都退過還是失敗，才是真的
   * 失敗——那時候把廠商的原話回報出去，不要自己改寫成「連不上」。
   */
  async function chatWithFallbacks(input: {
    model: string
    system: string
    user: string
    maxTokens: number
    json: boolean
  }): Promise<ChatResponse> {
    const attempts: { json: boolean; useCompletionTokens: boolean }[] = [
      { json: input.json, useCompletionTokens: false },
      ...(input.json ? [{ json: false, useCompletionTokens: false }] : []),
      { json: false, useCompletionTokens: true },
    ]

    let last = ''

    for (const attempt of attempts) {
      const { response, body, text } = await chat({ ...input, ...attempt })

      if (response.ok && body?.choices?.length) return body

      last = body?.error?.message || text.slice(0, 300)

      // 429 與 5xx 是「等一下再試」，不是參數問題——不要在這裡耗掉重試機會。
      if (response.status === 429 || response.status >= 500) {
        throw new AiAdapterError(`${config.label}：${last}`, 'rate_limited', true)
      }
      if (response.status === 401 || response.status === 403) {
        throw new AiAdapterError(
          `${config.label} 金鑰不正確或沒有權限：${last}`,
          'unauthorized',
          false
        )
      }
    }

    throw new AiAdapterError(`${config.label} 無法完成請求：${last}`, 'bad_request', false)
  }

  function costOf(inputTokens: number, outputTokens: number, usedModel: string): number | null {
    const rate = config.pricing?.[usedModel]
    // 查不到單價就回 null。編一個數字出來，成本中心會安靜地錯。
    if (!rate) return null
    return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output
  }

  return {
    kind: 'OPENAI_COMPATIBLE',
    label: config.label,
    supportedTasks: SUPPORTED_TASKS,

    async status(): Promise<AiProviderStatus> {
      if (!key) {
        return {
          available: false,
          reason: 'missing_key',
          detail: `未設定 API 金鑰${config.envVarName ? `（也沒有 ${config.envVarName}）` : ''}。`,
        }
      }
      if (config.enabled === false) {
        return { available: false, reason: 'disabled', detail: '此供應商已被停用。' }
      }
      if (!model) {
        return {
          available: false,
          reason: 'error',
          detail: '還沒有指定預設模型。按「抓取可用模型」或手動填一個。',
        }
      }
      return { available: true, model, detail: `已設定，預設模型 ${model}` }
    },

    async test() {
      if (!key) return { ok: false, message: '沒有金鑰，無法測試。' }
      if (!model) return { ok: false, message: '沒有預設模型，無法測試。' }

      try {
        await chatWithFallbacks({
          model,
          system: '只回一個字。',
          user: '回「好」這個字。',
          maxTokens: 16,
          json: false,
        })
        return { ok: true, message: `連得上，${model} 回應正常。` }
      } catch (cause) {
        return { ok: false, message: cause instanceof Error ? cause.message : '連不上' }
      }
    },

    async estimate(request: AiRunRequest): Promise<AiEstimate> {
      const used = request.model || model
      const user = buildUserMessage(request.task, request.context)
      const inputTokens = approximateTokens(SYSTEM_PROMPT) + approximateTokens(user)
      const maxOutputTokens = request.maxTokens ?? 8000

      return {
        inputTokens,
        maxOutputTokens,
        estimatedCostUsd: costOf(inputTokens, maxOutputTokens, used),
        model: used,
      }
    },

    async run(request: AiRunRequest): Promise<AiRunResult> {
      if (!key) throw new AiAdapterError(`${config.label} 還沒有設定金鑰`, 'missing_key', false)

      const used = request.model || model
      if (!used) throw new AiAdapterError(`${config.label} 還沒有指定模型`, 'no_model', false)

      const user = buildUserMessage(request.task, request.context)
      const wantsJson = STRUCTURED_TASKS.has(request.task)
      /*
       * 七家也走同一條優先序 (Z157)。
       *
       * 它們多半不是 adaptive thinking，所以不會有「額度全花在思考上」那個
       * 症狀；但「一份劇本寫到一半被截斷」是同一個太小的數字造成的，只是比
       * 較不容易看出來——截斷的輸出看起來就像模型寫得比較短。
       */
      const maxTokens = resolveMaxTokens({
        task: request.task,
        requested: request.maxTokens ?? null,
        profile: null,
        fallback: 8000,
      })
      const want = Math.min(Math.max(request.candidates ?? 1, 1), 3)

      const candidates: AiRunResult['candidates'] = []
      let inputTokens = 0
      let outputTokens = 0

      /*
       * 要幾個候選就叫幾次。
       *
       * 不用 `n` 參數：這七家對它的支援不一致，而被拒的代價是整個請求 400。
       * 多一次往返換「換廠商不會整個任務掛掉」，划算。
       */
      for (let index = 0; index < want; index += 1) {
        const body = await chatWithFallbacks({
          model: used,
          system: SYSTEM_PROMPT,
          user,
          maxTokens,
          json: wantsJson,
        })

        const content = body.choices?.[0]?.message?.content ?? ''
        if (!content.trim()) continue

        candidates.push({ label: `候選${String.fromCharCode(65 + index)}`, content })
        inputTokens += body.usage?.prompt_tokens ?? 0
        outputTokens += body.usage?.completion_tokens ?? 0
      }

      if (candidates.length === 0) {
        throw new AiAdapterError(`${config.label} 回了空白內容`, 'empty_response', true)
      }

      return {
        candidates,
        usage: {
          inputTokens,
          outputTokens,
          cacheReadTokens: 0,
          costUsd: costOf(inputTokens, outputTokens, used),
        },
        model: used,
      }
    },
  }
}

/**
 * 問廠商有哪些模型。
 *
 * 不寫死清單的理由在 `vendors.ts`：寫下去的那一刻就開始過期。七家有六家
 * 支援 `/models`，Gemini 的相容層沒做（實測 404），那一家要手動填。
 */
export async function listVendorModels(input: {
  baseUrl: string
  apiKey: string
}): Promise<{ ok: true; models: string[] } | { ok: false; reason: string }> {
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${input.apiKey}` },
    })

    if (!response.ok) {
      const text = (await response.text()).slice(0, 200)
      if (response.status === 404) {
        return { ok: false, reason: '這一家沒有提供模型清單端點，模型名要手動填。' }
      }
      return { ok: false, reason: `回 ${response.status}：${text}` }
    }

    const body = (await response.json()) as { data?: { id?: string }[] }
    const models = (body.data ?? [])
      .map((row) => row.id ?? '')
      .filter(Boolean)
      .sort()

    if (models.length === 0) return { ok: false, reason: '回應裡沒有模型。' }

    return { ok: true, models }
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : '連不上' }
  }
}
