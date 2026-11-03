/**
 * The production-progress contract (spec v3 §11.2).
 *
 * Every surface that shows a percentage — the global dashboard, a project's
 * overview, the episode list, the progress page — computes it here. Four
 * implementations of "how complete is this" would disagree the first time one
 * of them changed, and the spec is explicit that the calculation and the
 * rounding live in one place on the server.
 *
 * The rules, in full:
 *
 *   completed    counts 1
 *   in_progress  counts progressPercent / 100
 *   in_review    counts progressPercent / 100 — work that exists but has not
 *                been accepted is not finished
 *   blocked      counts progressPercent / 100 — blocked is not done, and a
 *                blocked stage must never be treated as complete
 *   not_started  counts 0
 *
 * An episode's progress is the sum of its nine fractions over nine, not an
 * average of per-stage percentages weighted by anything else. Across projects
 * it is total completed equivalents over total effective stages — never the
 * mean of each project's percentage, which would let a one-episode project
 * outvote a 120-episode one.
 */

export const PRODUCTION_STAGE_KEYS = [
  'story_planning',
  'novel',
  'script',
  'storyboard',
  'assets',
  'video',
  'postproduction',
  'review',
  'release',
] as const
export type ProductionStageKey = (typeof PRODUCTION_STAGE_KEYS)[number]

export const PRODUCTION_STAGE_LABEL: Record<ProductionStageKey, string> = {
  story_planning: '劇情規劃',
  novel: '小說創作',
  script: '劇本改編',
  storyboard: '分鏡設計',
  assets: '素材製作',
  video: '影像製作',
  postproduction: '後製剪輯',
  review: '審核調整',
  release: '上架發布',
}

/** Single character for the dense per-episode strip. */
export const PRODUCTION_STAGE_SHORT: Record<ProductionStageKey, string> = {
  story_planning: '劃',
  novel: '小',
  script: '劇',
  storyboard: '分',
  assets: '素',
  video: '影',
  postproduction: '後',
  review: '審',
  release: '發',
}

/** `01`–`09`, as the design numbers them. */
export function stageOrdinal(key: ProductionStageKey): string {
  return String(PRODUCTION_STAGE_KEYS.indexOf(key) + 1).padStart(2, '0')
}

export const PRODUCTION_STAGE_STATUSES = [
  'not_started',
  'in_progress',
  'blocked',
  'in_review',
  'completed',
] as const
export type ProductionStageStatus = (typeof PRODUCTION_STAGE_STATUSES)[number]

export const PRODUCTION_STAGE_STATUS_LABEL: Record<ProductionStageStatus, string> = {
  not_started: '未開始',
  in_progress: '進行中',
  blocked: '卡住',
  in_review: '待驗收',
  completed: '已完成',
}

export const PRODUCTION_STAGE_STATUS_STYLE: Record<ProductionStageStatus, string> = {
  not_started: 'bg-stage-800 text-ink-500 ring-stage-700',
  in_progress: 'bg-amber-500/20 text-amber-300 ring-amber-600/60',
  blocked: 'bg-rose-500/20 text-rose-300 ring-rose-600/60',
  in_review: 'bg-sky-500/20 text-sky-300 ring-sky-600/60',
  completed: 'bg-emerald-500/20 text-emerald-300 ring-emerald-600/60',
}

/** Dot colour for the compact stage strip on an episode row. */
export const PRODUCTION_STAGE_STATUS_DOT: Record<ProductionStageStatus, string> = {
  not_started: 'bg-stage-600',
  in_progress: 'bg-amber-400',
  blocked: 'bg-rose-500',
  in_review: 'bg-sky-400',
  completed: 'bg-emerald-400',
}

export const STAGES_PER_EPISODE = PRODUCTION_STAGE_KEYS.length

export type StageLike = {
  status: ProductionStageStatus
  progressPercent: number
}

/**
 * How much of one stage is done, as 0–1.
 *
 * Only `completed` is worth a whole stage. Everything else is capped by its
 * recorded percentage, so a stage cannot be finished by changing its status
 * alone — which is what the spec means by 「完成狀態必須對應必要驗收，不能只靠
 * 人工修改前端數字」.
 */
export function stageFraction(stage: StageLike): number {
  if (stage.status === 'completed') return 1
  if (stage.status === 'not_started') return 0

  const pct = Number(stage.progressPercent)
  if (!Number.isFinite(pct) || pct <= 0) return 0
  return Math.min(pct, 100) / 100
}

/**
 * An episode's progress, 0–1.
 *
 * The denominator is always the full nine stages, not the number of rows that
 * happen to exist: an episode missing its 上架發布 row is not 8/8 done.
 */
export function episodeProgress(stages: StageLike[]): number {
  if (stages.length === 0) return 0

  const sum = stages.reduce((total, stage) => total + stageFraction(stage), 0)
  return clamp01(sum / STAGES_PER_EPISODE)
}

/**
 * Progress across many episodes or many projects, 0–1.
 *
 * Completed equivalents over effective stages. `effectiveStages` is normally
 * `episodeCount * 9`, so episodes that have no stage rows yet still count
 * against the denominator — otherwise a project nobody has started reads as
 * 100% because its only row happens to be done.
 */
export function aggregateProgress(completedEquivalents: number, effectiveStages: number): number {
  if (effectiveStages <= 0) return 0
  return clamp01(completedEquivalents / effectiveStages)
}

/** The one rounding rule, so two surfaces never print 27% and 28%. */
export function toPercent(fraction: number): number {
  return Math.round(clamp01(fraction) * 100)
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), 1)
}

/**
 * SQL fragment for the same contract, for aggregating in the database.
 *
 * Kept beside the TypeScript version deliberately: if one changes the other
 * must, and a reviewer sees both at once. Tests assert they agree.
 */
export const STAGE_FRACTION_SQL = `
  case
    when status = 'completed' then 1.0
    when status = 'not_started' then 0.0
    else least(greatest(coalesce(progress_percent, 0), 0), 100) / 100.0
  end
`
