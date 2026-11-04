import Anthropic from '@anthropic-ai/sdk'
import { buildUserMessage, STRUCTURED_TASKS, SYSTEM_PROMPT, TASK_EFFORT } from './prompts'
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
 * Claude adapter. Resolves its credential from the DB-stored provider record
 * when one exists, otherwise from ANTHROPIC_API_KEY. Until a key is present,
 * `status()` reports `missing_key` and the UI renders its 不可用 state — the
 * adapter never fabricates output.
 */

export const DEFAULT_MODEL = 'claude-opus-5-5'

/**
 * Default output ceiling for one generation.
 *
 * Sized for the Vercel Hobby plan, whose serverless functions are killed at
 * 60s: a request that would run longer is not "slow", it is lost work that was
 * still billed by the provider. 8k output tokens comfortably fits that budget.
 *
 * Raise it with AI_MAX_OUTPUT_TOKENS once the deployment allows longer
 * functions (Pro permits 300s), or pass `maxTokens` per request.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = Number(
  process.env.AI_MAX_OUTPUT_TOKENS ?? 8000
)

/** What the model picker offers. Current generation only. */
export const AVAILABLE_MODELS = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
] as const

/**
 * USD per million tokens, for the estimate shown before a run and the actual
 * cost recorded after one.
 *
 * Superseded models stay in the table even though the picker no longer offers
 * them: a job run last month was priced at that model's rate, and re-pricing
 * history to whatever is current would quietly rewrite the cost ledger.
 */
const PRICING: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  // Cache read is not published separately for Haiku 5.5; the usual ~0.1x of
  // input is used, and it is a floor on the estimate rather than a claim.
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },

  // --- superseded, kept for historical cost records -----------------------
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
}

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

export type AnthropicAdapterConfig = {
  /** Decrypted key, or null to fall back to ANTHROPIC_API_KEY. */
  apiKey?: string | null
  defaultModel?: string
  baseUrl?: string
  enabled?: boolean
  /**
   * Rates and per-task settings read from `app_settings`, merged over the
   * built-in tables by the caller. Passed in rather than read here so the
   * adapter stays synchronous and free of database imports.
   */
  pricing?: Record<string, { input: number; output: number; cacheRead: number }>
  taskProfiles?: Record<string, { model?: string; effort: 'low' | 'medium' | 'high' }>
}

/** The built-in table, exported so the settings layer can merge over it. */
export { PRICING as BUILT_IN_PRICING }

export function createAnthropicAdapter(config: AnthropicAdapterConfig = {}): AiAdapter {
  const resolvedKey = config.apiKey || process.env.ANTHROPIC_API_KEY || null
  const model = config.defaultModel || DEFAULT_MODEL

  function clientOrThrow(): Anthropic {
    if (!resolvedKey) {
      throw new AiAdapterError(
        'Claude 尚未設定 API 金鑰。請在 AI 供應商設定中填入，或設定 ANTHROPIC_API_KEY 環境變數。',
        'missing_key',
        false
      )
    }
    return new Anthropic({
      apiKey: resolvedKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    })
  }

  const pricing = { ...PRICING, ...(config.pricing ?? {}) }
  const taskProfiles = config.taskProfiles ?? {}

  function priceFor(modelId: string) {
    return pricing[modelId] ?? null
  }

  return {
    kind: 'ANTHROPIC',
    label: 'Claude（文字）',
    supportedTasks: SUPPORTED_TASKS,

    async status(): Promise<AiProviderStatus> {
      if (!resolvedKey) {
        return {
          available: false,
          reason: 'missing_key',
          detail: '未設定 API 金鑰。填入金鑰後即可使用文字生成功能。',
        }
      }
      if (config.enabled === false) {
        return { available: false, reason: 'disabled', detail: '此供應商已被停用。' }
      }
      return { available: true, model, detail: `已設定，預設模型 ${model}` }
    },

    async test() {
      try {
        const client = clientOrThrow()
        // Smallest possible round-trip that still proves auth and model access.
        const response = await client.messages.create({
          model,
          max_tokens: 16,
          messages: [{ role: 'user', content: '回覆 OK 兩個字。' }],
        })
        const text = response.content.find((b) => b.type === 'text')
        return {
          ok: true,
          message: `連線成功（${response.model}）：${text?.type === 'text' ? text.text.trim() : ''}`,
        }
      } catch (error) {
        return { ok: false, message: describeError(error) }
      }
    },

    async estimate(request: AiRunRequest): Promise<AiEstimate> {
      const modelId = request.model || model
      const maxOutputTokens = request.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS

      if (!resolvedKey) {
        // Without a key we cannot call count_tokens; approximate from characters.
        const message = buildUserMessage(request.task, request.context)
        const approx = Math.ceil((SYSTEM_PROMPT.length + message.length) / 2.5)
        return {
          inputTokens: approx,
          maxOutputTokens,
          estimatedCostUsd: null,
          model: modelId,
        }
      }

      const client = clientOrThrow()
      const counted = await client.messages.countTokens({
        model: modelId,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(request.task, request.context) }],
      })

      const price = priceFor(modelId)
      const candidates = request.candidates ?? 1
      const estimatedCostUsd = price
        ? (counted.input_tokens * price.input) / 1_000_000 +
          (maxOutputTokens * candidates * price.output) / 1_000_000
        : null

      return {
        inputTokens: counted.input_tokens,
        maxOutputTokens: maxOutputTokens * candidates,
        estimatedCostUsd,
        model: modelId,
      }
    },

    async run(request: AiRunRequest): Promise<AiRunResult> {
      const client = clientOrThrow()
      const modelId = request.model || model
      const candidateCount = Math.min(Math.max(request.candidates ?? 1, 1), 3)
      const maxTokens = request.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS

      const userMessage = buildUserMessage(request.task, request.context)
      const wantsJson = STRUCTURED_TASKS.has(request.task)

      const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
      const candidates: AiRunResult['candidates'] = []
      /** Why each attempt came back with no text, for a usable error. */
      const emptyReasons: string[] = []

      let refusal: AiRunResult['refusal']

      for (let i = 0; i < candidateCount; i++) {
        try {
          // Streaming: these outputs are long, and a non-streaming request at
          // this max_tokens would risk an HTTP timeout.
          const stream = client.messages.stream({
            model: modelId,
            max_tokens: maxTokens,
            system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
            thinking: { type: 'adaptive' },
            /*
             * Effort is set explicitly rather than left to the model: Claude
             * Opus 5.5 defaults to `medium`, one level below the previous
             * generation, so omitting it would quietly lower output quality
             * on an upgrade.
             *
             * Per task rather than one global `high`: 潤稿 is a local edit and
             * 大綱 mostly follows a given format, and making either of them
             * think hard costs latency and output tokens for no gain. The
             * caller can still override.
             */
            output_config: {
              // Explicit request wins, then the configured profile, then the
              // built-in judgement call.
              effort:
                request.effort ?? taskProfiles[request.task]?.effort ?? TASK_EFFORT[request.task] ?? 'high',
            },
            messages: [
              {
                role: 'user',
                content:
                  candidateCount > 1
                    ? `${userMessage}\n\n（這是第 ${i + 1} 個候選版本，請與其他版本採取不同的取捨。）`
                    : userMessage,
              },
            ],
          })

          const message = await stream.finalMessage()

          usage.inputTokens += message.usage.input_tokens ?? 0
          usage.outputTokens += message.usage.output_tokens ?? 0
          usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0

          if (message.stop_reason === 'refusal') {
            refusal = {
              category: message.stop_details?.category ?? null,
              explanation: message.stop_details?.explanation ?? '供應商拒絕了這個請求。',
            }
            continue
          }

          const text = message.content
            .filter((block) => block.type === 'text')
            .map((block) => (block.type === 'text' ? block.text : ''))
            .join('')
            .trim()

          if (!text) {
            /*
             * Empty output is not one failure, it is several, and they need
             * different answers (Z126). The commonest is the thinking budget
             * eating the whole of `max_tokens` so there is nothing left to
             * write with — which looks identical from here to a model that
             * simply said nothing. Record what the API actually reported so
             * the error can name it instead of saying 「請重試」.
             */
            emptyReasons.push(
              `stop_reason=${message.stop_reason ?? '?'}` +
                `, 區塊=${message.content.map((b) => b.type).join('+') || '無'}` +
                `, 輸出 ${message.usage.output_tokens ?? 0} token（上限 ${maxTokens}）`
            )
            continue
          }

          candidates.push({
            label: candidateCount > 1 ? `候選${String.fromCharCode(65 + i)}` : '候選',
            content: text,
            ...(wantsJson ? { structured: tryParseJson(text) } : {}),
          })
        } catch (error) {
          // One failed candidate should not discard the ones that succeeded.
          if (candidates.length === 0 && i === candidateCount - 1) {
            throw toAdapterError(error)
          }
          console.error('[ai] candidate failed:', describeError(error))
        }
      }

      if (candidates.length === 0 && !refusal) {
        /*
         * `max_tokens` with nothing but a thinking block is not a transient
         * failure — retrying spends the same money to reach the same place.
         * Say so, and say what to change.
         */
        const starved = emptyReasons.some((reason) => reason.includes('stop_reason=max_tokens'))

        throw new AiAdapterError(
          starved
            ? `模型把輸出額度用在思考上，沒有留下內容（${emptyReasons[0]}）。` +
              '在系統設定把這個任務的思考程度調低，或把輸出上限調高。'
            : `模型沒有產出任何內容（${emptyReasons.join('；') || '沒有更多資訊'}）。`,
          'empty_result',
          // Retrying a starved request just spends the money again.
          !starved
        )
      }

      const price = priceFor(modelId)
      const costUsd = price
        ? (usage.inputTokens * price.input) / 1_000_000 +
          (usage.outputTokens * price.output) / 1_000_000 +
          (usage.cacheReadTokens * price.cacheRead) / 1_000_000
        : null

      return {
        candidates,
        usage: { ...usage, costUsd },
        model: modelId,
        ...(refusal ? { refusal } : {}),
      }
    },
  }
}

/** Models may wrap JSON in prose or a fence; extract the first JSON value. */
function tryParseJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidate = (fenced?.[1] ?? text).trim()

  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.search(/[[{]/)
    if (start === -1) return null
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'))
    if (end <= start) return null
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'API 金鑰無效或已失效。'
  if (error instanceof Anthropic.PermissionDeniedError) return '此金鑰沒有存取該模型的權限。'
  if (error instanceof Anthropic.RateLimitError) return '已達速率上限，請稍後重試。'
  if (error instanceof Anthropic.NotFoundError) return '找不到指定的模型。'
  if (error instanceof Anthropic.BadRequestError) return `請求不正確：${error.message}`
  if (error instanceof Anthropic.APIConnectionError) return '無法連線到 Claude API。'
  if (error instanceof Anthropic.APIError) return `API 錯誤 ${error.status}：${error.message}`
  if (error instanceof AiAdapterError) return error.message
  return error instanceof Error ? error.message : String(error)
}

function toAdapterError(error: unknown): AiAdapterError {
  if (error instanceof AiAdapterError) return error

  // Rate limits, connection failures and 5xx are worth retrying; 4xx is not.
  const retryable =
    error instanceof Anthropic.RateLimitError ||
    error instanceof Anthropic.APIConnectionError ||
    (error instanceof Anthropic.APIError && (error.status ?? 500) >= 500)

  const code =
    error instanceof Anthropic.AuthenticationError
      ? 'auth'
      : error instanceof Anthropic.RateLimitError
        ? 'rate_limit'
        : error instanceof Anthropic.APIError
          ? `http_${error.status}`
          : 'unknown'

  return new AiAdapterError(describeError(error), code, retryable)
}
