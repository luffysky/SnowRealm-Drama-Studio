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
  /** 這句話是誰說的，給分角色朗讀與有聲書用（Z132）。 */
  | 'DIALOGUE_ATTRIBUTE'

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

/* -------------------------------------------------------------------------- */
/* 媒體生成（圖片 / 影片 / 語音）                                                */
/* -------------------------------------------------------------------------- */

/**
 * Media generation is a different shape from text, in three ways that matter:
 *
 * 1. **Output is a file**, not a string. It lands in R2 as an asset.
 * 2. **Billing is not per token.** Images are per image, video per second,
 *    speech per character. Reporting any of them as tokens would make the cost
 *    estimate a fiction.
 * 3. **It can take minutes.** Longer than a serverless function may run, so a
 *    media job is submitted, abandoned, and polled on a later tick — which is
 *    why this contract is `submit` + `poll` rather than `run`.
 */

export type MediaKind = 'IMAGE' | 'VIDEO' | 'AUDIO'

export type MediaReference = {
  /** A URL the provider can fetch. Minted short-lived from our own bucket. */
  url: string
  /**
   * What the reference is for. `first_frame` / `last_frame` drive
   * image-to-video, which is how a 120-episode drama keeps one face across
   * episodes — the keyframe is approved as an image first, cheaply.
   */
  role: 'character' | 'style' | 'first_frame' | 'last_frame' | 'audio'
}

export type MediaRequest = {
  task: AiTaskKind
  kind: MediaKind
  prompt: string
  negativePrompt?: string
  references?: MediaReference[]
  model?: string
  /** How many to produce. Each one is billed. */
  count?: number
  aspectRatio?: string
  /** Video only. */
  durationSec?: number
  /** Reusing a seed is the cheapest way to get a near-identical retry. */
  seed?: number
  options?: Record<string, string | number | boolean>
}

/**
 * What a media run will cost, in the unit the provider actually bills.
 *
 * `unit` is part of the estimate rather than assumed, so the UI can say
 * 「18 秒 × $0.09」 instead of inventing a token count nobody is charged for.
 */
export type MediaEstimate = {
  unit: 'image' | 'second' | 'character' | 'request'
  quantity: number
  estimatedCostUsd: number | null
  model: string
}

export type MediaArtifact = {
  /** Where the provider is serving it. Fetched once and stored in R2. */
  url: string
  mimeType: string
  width?: number
  height?: number
  durationSec?: number
}

export type MediaResult = {
  artifacts: MediaArtifact[]
  model: string
  /** What it actually cost, when the provider reports it. */
  costUsd: number | null
}

/**
 * The outcome of submitting. Fast providers answer immediately; slow ones
 * return a handle to poll.
 */
export type MediaSubmission =
  | { state: 'pending'; externalId: string; note?: string }
  | { state: 'done'; result: MediaResult }

export type MediaPoll =
  | { state: 'pending'; progress?: number; note?: string }
  | { state: 'done'; result: MediaResult }
  | { state: 'failed'; message: string; retryable: boolean }

export interface MediaAdapter {
  readonly kind: 'IMAGE_GENERIC' | 'VIDEO_GENERIC' | 'TTS_GENERIC'
  readonly label: string
  readonly media: readonly MediaKind[]
  readonly supportedTasks: readonly AiTaskKind[]

  status(): Promise<AiProviderStatus>
  test(): Promise<{ ok: boolean; message: string }>
  estimate(request: MediaRequest): Promise<MediaEstimate>

  /** Starts the work. Must be safe to call once per job, never twice. */
  submit(request: MediaRequest): Promise<MediaSubmission>

  /** Asks how it is going. Called repeatedly; must not start new work. */
  poll(externalId: string): Promise<MediaPoll>

  /**
   * Best-effort cancel at the provider. Optional because several providers
   * have no such endpoint — and when they do not, the generation keeps running
   * and is still billed, which the caller has to be told rather than guess.
   */
  cancel?(externalId: string): Promise<void>
}
