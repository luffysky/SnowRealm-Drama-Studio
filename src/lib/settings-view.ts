/**
 * 系統設定裡不碰資料庫的那一半 (Z87).
 *
 * `settings.ts` imports Drizzle, so anything a client component needs from it
 * — a type, a list of efforts, a default — has to live here instead, or the
 * whole database layer is pulled into the browser bundle. Same split as
 * `chat-view.ts` and `novel-reader-view.ts`.
 */

export const AI_EFFORTS = ['low', 'medium', 'high'] as const
export type AiEffort = (typeof AI_EFFORTS)[number]

/** Which model and how much deliberation each task gets. */
export type TaskProfile = { model?: string; effort: AiEffort }
export type TaskProfiles = Record<string, TaskProfile>

/** USD per million tokens, per model. */
export type ModelPrice = { input: number; output: number; cacheRead: number }
export type ModelPricing = Record<string, ModelPrice>

export type StorageCost = {
  usdPerGbMonth: number
  freeTierGb: number
  /** ISO date the rate was taken from the provider's page. */
  asOf: string
  source: string
}

export type IceServer = {
  urls: string[]
  username?: string
  credential?: string
}
