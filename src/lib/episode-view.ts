import type { EpisodeStatusValue } from '@/lib/constants'
import type { ProductionStageKey, ProductionStageStatus } from '@/lib/production'

/**
 * Types and option lists for 集數管理, with no database import.
 *
 * `src/lib/episodes.ts` reaches for Drizzle and therefore `pg`, which pulls
 * `fs` and `dns` into anything that imports it. A Client Component that only
 * needed the sort labels was enough to break the build, so the pure half lives
 * here and the querying half imports from it.
 */

export const PER_PAGE_OPTIONS = [10, 20, 50] as const
export type PerPage = (typeof PER_PAGE_OPTIONS)[number]

export const DEFAULT_PER_PAGE: PerPage = 10

export const EPISODE_SORTS = ['NUMBER_ASC', 'NUMBER_DESC', 'PROGRESS_DESC', 'UPDATED_DESC'] as const
export type EpisodeSort = (typeof EPISODE_SORTS)[number]

export const EPISODE_SORT_LABEL: Record<EpisodeSort, string> = {
  NUMBER_ASC: '集數由小到大',
  NUMBER_DESC: '集數由大到小',
  PROGRESS_DESC: '完成率由高到低',
  UPDATED_DESC: '最近更新',
}

export const EPISODE_VIEWS = ['LIST', 'CARD', 'PROGRESS', 'SEGMENT'] as const
export type EpisodeView = (typeof EPISODE_VIEWS)[number]

export const EPISODE_VIEW_LABEL: Record<EpisodeView, string> = {
  LIST: '列表檢視',
  CARD: '卡片檢視',
  PROGRESS: '進度總覽',
  SEGMENT: '分段檢視',
}

export type EpisodeStageCell = {
  key: ProductionStageKey
  status: ProductionStageStatus
  progressPercent: number
  /**
   * 這個階段的備註 (Z165).
   *
   * 本來不在這個型別裡，而階段看板已經在顯示它——於是那段顯示永遠拿到空字
   * 串。API 收 note、lib 寫 note、看板畫 note，中間就缺這一欄。
   */
  note: string
}

export type EpisodeRow = {
  id: string
  number: number
  title: string
  logline: string
  status: EpisodeStatusValue
  coverAssetId: string | null
  dueDate: Date | null
  updatedAt: Date
  /** 0–1, from the completion contract. */
  progress: number
  /** Always nine cells, in pipeline order, even where no row exists yet. */
  stages: EpisodeStageCell[]
}

export type StageColumn = {
  key: ProductionStageKey
  /** 這個階段已完成的集數。 */
  done: number
  total: number
  /** 0–1，含進行中的部分分數。 */
  progress: number
}

export type EpisodeSegment = {
  from: number
  to: number
  total: number
  done: number
  inProgress: number
  pending: number
  /** 0–1。 */
  progress: number
}

export type EpisodeStats = {
  total: number
  done: number
  inProgress: number
  pending: number
  /** 0–1 across every stage record of the project. */
  overallProgress: number
}

export type EpisodeQuery = {
  page?: number
  perPage?: PerPage
  search?: string
  status?: EpisodeStatusValue
  /** Only episodes whose given stage is unfinished. */
  stage?: ProductionStageKey
  /** Only the episodes filed under one 卷 (Z128). */
  arcId?: string
  sort?: EpisodeSort
}

export type EpisodeListResult = {
  rows: EpisodeRow[]
  /** Episodes matching the filters, before paging. */
  matched: number
  page: number
  perPage: PerPage
  pageCount: number
  /** Unfiltered, so the headline figures do not move when a filter is applied. */
  stats: EpisodeStats
}

export function parsePerPage(value: unknown): PerPage {
  const n = Number(value)
  return (PER_PAGE_OPTIONS as readonly number[]).includes(n) ? (n as PerPage) : DEFAULT_PER_PAGE
}

export function parseSort(value: unknown): EpisodeSort {
  return (EPISODE_SORTS as readonly string[]).includes(String(value))
    ? (value as EpisodeSort)
    : 'NUMBER_ASC'
}

export function parseView(value: unknown): EpisodeView {
  return (EPISODE_VIEWS as readonly string[]).includes(String(value))
    ? (value as EpisodeView)
    : 'LIST'
}

