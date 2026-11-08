import type {
  ShotStatusValue,
} from '@/lib/constants'

/**
 * 分鏡的純邏輯與型別 (Z39).
 *
 * 跟 `episode-view.ts`、`batch-view.ts` 同一個理由，而這次是 `next build` 教
 * 的：`storyboard.ts` import 了 `@/db` 與 `@/lib/api`（它要 `next/headers`），
 * 而分鏡工作台是用戶端元件、要用 `formatSeconds` 跟 `DurationCheck`——於是整
 * 包伺服器端程式被拖進瀏覽器的 bundle，建置直接失敗。
 *
 * 型別檢查不會抓到這件事，`npm run check` 也不會。只有 `next build` 會。
 */

/* -------------------------------------------------------------------------- */
/* 純函式                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 容許誤差。
 *
 * 10% 是因為鏡頭秒數本來就是估的：一個「5 秒」的鏡頭實拍出來 4.6 秒或 5.4 秒
 * 都正常。抓太嚴會讓這個警告永遠亮著，而永遠亮著的警告等於沒有。
 */
export const DURATION_TOLERANCE = 0.1

export type DurationVerdict = 'NO_TARGET' | 'OK' | 'SHORT' | 'LONG'

export type DurationCheck = {
  totalSec: number
  targetSec: number
  /** 正數代表超過目標。 */
  deltaSec: number
  verdict: DurationVerdict
  /** 容許範圍，給介面照實說出來。 */
  lowSec: number
  highSec: number
}

/**
 * 鏡頭秒數加起來，對照這一集的目標片長。
 *
 * `targetSec` 是 0 的時候回 `NO_TARGET` 而不是「OK」：沒有目標就沒有「對」
 * 可言，而把它當成通過會讓這個檢查在最需要它的時候（還沒設目標的新集數）
 * 保持安靜。
 */
export function durationCheck(
  durations: readonly number[],
  targetSec: number
): DurationCheck {
  const totalSec = durations.reduce((sum, value) => sum + value, 0)

  if (!targetSec || targetSec <= 0) {
    return {
      totalSec,
      targetSec: 0,
      deltaSec: 0,
      verdict: 'NO_TARGET',
      lowSec: 0,
      highSec: 0,
    }
  }

  const lowSec = Math.round(targetSec * (1 - DURATION_TOLERANCE))
  const highSec = Math.round(targetSec * (1 + DURATION_TOLERANCE))

  return {
    totalSec,
    targetSec,
    deltaSec: totalSec - targetSec,
    verdict: totalSec < lowSec ? 'SHORT' : totalSec > highSec ? 'LONG' : 'OK',
    lowSec,
    highSec,
  }
}

/** 秒數寫成 1:05 這種人看得懂的形式。 */
export function formatSeconds(totalSec: number): string {
  const safe = Math.max(0, Math.round(totalSec))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/* -------------------------------------------------------------------------- */
/* 型別                                                                        */
/* -------------------------------------------------------------------------- */

export type ShotRow = {
  id: string
  order: number
  sceneCode: string
  durationSec: number
  /*
   * `string`，不是那個列舉 (Z184).
   *
   * 景別與運鏡可以有使用者自己加的值，所以型別不能是「內建那八個之一」——那
   * 會讓每一個讀它的地方在編譯期相信一件執行期不成立的事。要顯示的時候走
   * `vocabularyTermLabel`，它查不到會回值本身。
   */
  shotSize: string
  camera: string
  location: string
  timeOfDay: string
  action: string
  dialogue: string
  speakerId: string | null
  speakerName: string | null
  prompt: string
  negativePrompt: string
  status: ShotStatusValue
  notes: string
  updatedAt: Date
  /** 人上傳的參考圖，依上傳順序 (Z183)。 */
  references: ShotReference[]
}

/** 一張掛在鏡頭上的參考圖。 */
export type ShotReference = {
  assetId: string
  /** 標題優先，沒有就用檔名——縮圖要有 alt，而「圖片」不是 alt。 */
  label: string
}

export type StoryboardEpisode = {
  id: string
  number: number
  title: string
  targetSec: number
  shotCount: number
  totalSec: number
  approved: number
  /** 有沒有劇本可以據以生成分鏡。 */
  hasScript: boolean
}

export type StoryboardView = {
  episode: { id: string; number: number; title: string; targetSec: number }
  shots: ShotRow[]
  duration: DurationCheck
  /** 這部作品的角色，給「這句話誰說的」下拉。 */
  cast: { id: string; name: string }[]
  /** 這一集有沒有劇本——沒有的話 AI 分鏡生成按鈕要禁用並說原因。 */
  hasScript: boolean
}

export type ShotPatch = {
  sceneCode?: string
  durationSec?: number
  shotSize?: string
  camera?: string
  location?: string
  timeOfDay?: string
  action?: string
  dialogue?: string
  speakerId?: string | null
  prompt?: string
  negativePrompt?: string
  status?: ShotStatusValue
  notes?: string
}
