import type { AiJobKindValue } from '@/lib/constants'

/**
 * The client-safe half of 批次生成 (Z127-3).
 *
 * Split out for one reason: `./batch.ts` imports `@/db`, and a client
 * component importing a constant from it drags Drizzle and the Postgres
 * driver into the browser bundle. Same `*-view` convention the rest of the
 * codebase uses for exactly this.
 */

/** Per press. A range wider than this is split, deliberately. */
export const MAX_BATCH = 30

/**
 * Tasks that mean something per episode.
 *
 * 作品企劃 and 世界觀 are per work, so a batch of them is the same request
 * repeated; 素材生成 needs a prompt per asset. Both are left out rather than
 * offered and then refused.
 */
export const BATCH_TASKS = [
  'OUTLINE_GENERATE',
  'NOVEL_TO_SCRIPT',
  'SCRIPT_ANALYZE',
  'STORYBOARD_GENERATE',
  'NOVEL_REVIEW',
] as const satisfies readonly AiJobKindValue[]

export type BatchTask = (typeof BATCH_TASKS)[number]

export type BatchCandidate = {
  episodeId: string
  number: number
  title: string
  /** Null when it can be queued; otherwise why it cannot. */
  skipReason: string | null
  /** Characters of prose, for 小說-sourced tasks. */
  novelChars: number
  scriptScenes: number
}

export type BatchPlan = {
  task: BatchTask
  projectId: string
  projectTitle: string
  candidates: BatchCandidate[]
  runnable: number
  skipped: number
  /** Null when no provider could price it. */
  estimatedTotal: number | null
  capped: boolean
}

export type BatchResult = {
  queued: { episodeId: string; number: number; jobId: string }[]
  skipped: { number: number; reason: string }[]
  estimatedTotal: number | null
}
