/**
 * The pluggable adapter contract (spec §一「AI 供應商使用可插拔後端適配器」).
 *
 * An adapter is a thin translation layer: it takes a studio-level request,
 * calls one provider, and returns candidates plus token usage. It never writes
 * to the database and never decides that output is good enough — the AI job
 * record holds the result in AWAITING_REVIEW until a human applies it.
 */

export type AiTaskKind =
  | 'PROJECT_PLAN'
  | 'OUTLINE_GENERATE'
  | 'OUTLINE_REVIEW'
  | 'NOVEL_CONTINUE'
  | 'NOVEL_REWRITE'
  | 'NOVEL_POLISH'
  | 'NOVEL_REVIEW'
  | 'NOVEL_TO_SCRIPT'
  | 'SCRIPT_ANALYZE'
  | 'WORLD_GENERATE'
  | 'WORLD_CONSISTENCY'
  | 'CHARACTER_DESIGN'
  | 'STORYBOARD_GENERATE'
  | 'ASSET_GENERATE'
  | 'TASK_SUGGEST'

/** Background the adapter puts in front of the task instruction. */
export type AiContext = {
  /** 作品 / 篇章 / 集數 identity, so the model knows what it is writing for. */
  projectTitle?: string
  arcTitle?: string
  episodeNumber?: number
  episodeTitle?: string
  /** Target runtime for the episode, in seconds. */
  targetSec?: number
  /** Canon world entries the output must not contradict. */
  worldEntries?: { title: string; category: string; body: string }[]
  /** Characters in play, including the locked visual prompt. */
  characters?: { name: string; tier: string; appearance?: string; personality?: string }[]
  /** Source text: the novel being adapted, the scene being storyboarded, etc. */
  sourceText?: string
  /** Free-form extra instructions typed by the user. */
  userInstruction?: string
}

export type AiRunRequest = {
  task: AiTaskKind
  context: AiContext
  /** How many alternative candidates to produce (A/B comparison needs 2). */
  candidates?: number
  /** Model id; falls back to the provider's configured default. */
  model?: string
  /** Maps to the API's output_config.effort. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  maxTokens?: number
  /** Tone / length / style knobs from the AI writing settings dialog. */
  options?: Record<string, string | number | boolean>
}

export type AiUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  /** Cost in USD computed from the model's published per-token rates. */
  costUsd: number | null
}

export type AiCandidate = {
  /** Stable label shown in the comparison dialog: 候選A / 候選B. */
  label: string
  /** The produced text, or JSON-encoded structure for storyboard/task output. */
  content: string
  /** Set when the adapter returned structured data rather than prose. */
  structured?: unknown
}

export type AiRunResult = {
  candidates: AiCandidate[]
  usage: AiUsage
  model: string
  /** Set when the provider declined the request rather than failing. */
  refusal?: { category: string | null; explanation: string }
}

export type AiEstimate = {
  inputTokens: number
  /** Upper bound, since output length is not known in advance. */
  maxOutputTokens: number
  estimatedCostUsd: number | null
  model: string
}

export type AiProviderStatus =
  | { available: true; model: string; detail: string }
  /** Rendered as the dialog's explicit 不可用 state, with the reason shown. */
  | { available: false; reason: 'missing_key' | 'disabled' | 'error'; detail: string }

export interface AiAdapter {
  readonly kind: 'ANTHROPIC' | 'IMAGE_GENERIC' | 'VIDEO_GENERIC' | 'TTS_GENERIC'
  readonly label: string
  /** Tasks this adapter can serve; the UI hides the rest. */
  readonly supportedTasks: readonly AiTaskKind[]

  /** Whether a usable credential is present. Never throws. */
  status(): Promise<AiProviderStatus>

  /** Cheap round-trip used by the 連線測試 tab. */
  test(): Promise<{ ok: boolean; message: string }>

  /** Token and cost estimate shown before the user commits to a run. */
  estimate(request: AiRunRequest): Promise<AiEstimate>

  run(request: AiRunRequest): Promise<AiRunResult>
}

/** Thrown by adapters so the job queue can distinguish retryable failures. */
export class AiAdapterError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'AiAdapterError'
  }
}
