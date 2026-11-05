import { ApiError } from '@/lib/api-error'

/**
 * 批次建立集數的純邏輯 (Z66).
 *
 * 跟 `storyboard-view.ts`、`digest.ts` 同一個理由，而這次又是 `next build`
 * 教的——**今天第三次**：`episode-batch.ts` import 了 `@/db` 與 `@/lib/api`
 * （它要 `next/headers`），而批次建立的對話框是用戶端元件、要用
 * `episodeTitleFor` 來即時預覽標題。於是整包伺服器端程式被拖進瀏覽器的
 * bundle，建置失敗。
 *
 * `npm run check` 對這件事是綠的。只有 `next build` 會抓到——所以它現在也進
 * 了門檻（`scripts/check-client-boundary.ts`）。
 */

/* -------------------------------------------------------------------------- */
/* 純函式                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 依樣板算出一集的標題。
 *
 * `{n}` 換成集號、`{nnn}` 換成補零到三位的集號。樣板空白就回空字串——**不要
 * 自己編一個標題**。一個叫「第 7 集」的標題沒有比空白多說任何事，但它會讓
 * 「哪幾集還沒命名」這個問題再也答不出來。
 */
export function episodeTitleFor(template: string, number: number): string {
  const trimmed = template.trim()
  if (!trimmed) return ''

  return trimmed
    .replace(/\{nnn\}/g, String(number).padStart(3, '0'))
    .replace(/\{n\}/g, String(number))
    .slice(0, 120)
}

export type BatchPlan = {
  /** 會被建立的集號。 */
  create: number[]
  /** 已經存在、被跳過的集號。 */
  skipped: number[]
}

/**
 * 這一批實際會建哪幾集。
 *
 * `skipExisting` 是 false 而範圍內有集數已存在時丟錯，不是默默少建幾集：
 * `unique(project_id, number)` 會擋下來，而一個「建了 7 集、第 8 集撞號整批
 * 回滾」的結果，比事前說清楚難理解得多。
 */
export function planEpisodeBatch(input: {
  from: number
  to: number
  existing: readonly number[]
  skipExisting: boolean
}): BatchPlan {
  const taken = new Set(input.existing)
  const create: number[] = []
  const skipped: number[] = []

  for (let n = input.from; n <= input.to; n += 1) {
    if (taken.has(n)) skipped.push(n)
    else create.push(n)
  }

  if (!input.skipExisting && skipped.length > 0) {
    throw ApiError.badRequest(
      `第 ${skipped.slice(0, 5).join('、')}${skipped.length > 5 ? ' 等' : ''} 集已經存在。` +
        '勾選「跳過已存在的集數」再試一次，或換一個範圍。'
    )
  }

  return { create, skipped }
}
