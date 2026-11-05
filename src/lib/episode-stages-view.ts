import type { ProductionStageKey } from '@/lib/production'

/**
 * 九大階段裡哪幾個是自動量測的 (Z36).
 *
 * 純的那一半，跟查資料的 `episode-stages.ts` 分開——階段看板是用戶端元件，
 * 要用這兩個判斷。這是今天第四次拆（前三次是 storyboard、digest、
 * episode-batch），所以這次先拆再寫。
 */

/** 會被內容量測覆寫的階段。`stage-sync.ts` 的 `DERIVED_STAGES` 的鏡像。 */
export const MEASURED_STAGES: readonly ProductionStageKey[] = [
  'novel',
  'script',
  'storyboard',
  'assets',
]

/** 這一個階段手動設成「已完成」之後會不會被自動同步收回。 */
export function stageCompletionSticks(stage: ProductionStageKey): boolean {
  // 只有小說會被收回：它的完成是從正文推導的。
  return stage !== 'novel'
}
