'use client'

import { VERDICT_HINT, VERDICT_LABEL, type VerdictCode } from '@/lib/ai/story-audit-view'
import { cn } from '@/lib/utils'

/**
 * 四種判定長什麼樣子（Z198 做的，Z202 抽出來共用）。
 *
 * **「合理留白」不是警告**：那是一個「不用改」的結論，所以它是綠的。第一版把
 * 四種都畫成同一個灰，結果整份報告讀起來像四十條待辦。
 *
 * ## 為什麼要抽出來
 *
 * 原本編劇助手（`WriterAssistant`）與說明頁（`WriterGuide`）各寫一份，而它們
 * **當天就開始漂移**了——「合理留白」的底色一邊 `/25` 一邊 `/30`。說明頁顯示的
 * 顏色跟真實畫面不一樣，恰好是說明頁最不該出的錯：讀的人照著顏色去認，認到的是
 * 另一個東西。
 *
 * 顏色本身就是這個功能的語意，不是裝飾，所以它跟 `VERDICT_LABEL` 一樣只能有一
 * 份。留在這裡而不是 `story-audit-view.ts`，是因為那一份是**純解析層**，不該知
 * 道 Tailwind 的存在。
 */
export const VERDICT_TONE: Record<VerdictCode, string> = {
  HELD_BACK: 'bg-emerald-950/25 ring-emerald-900/40',
  UNDER_SEEDED: 'bg-amber-950/25 ring-amber-900/40',
  REAL_HOLE: 'bg-rose-950/30 ring-rose-900/50',
  NOT_ENOUGH_INFO: 'bg-stage-850/60 ring-stage-700/50',
}

const PILL: Record<VerdictCode, string> = {
  HELD_BACK: 'bg-emerald-500/15 text-emerald-300 ring-emerald-700/50',
  UNDER_SEEDED: 'bg-amber-500/15 text-amber-300 ring-amber-700/50',
  REAL_HOLE: 'bg-rose-500/15 text-rose-300 ring-rose-700/50',
  NOT_ENOUGH_INFO: 'bg-stage-800 text-ink-400 ring-stage-600',
}

/** 說明頁的大顆版本才帶圖示——報告裡一排小籤掛滿表情符號會讀不下去。 */
const EMOJI: Record<VerdictCode, string> = {
  HELD_BACK: '🤫',
  UNDER_SEEDED: '🌱',
  REAL_HOLE: '🕳️',
  NOT_ENOUGH_INFO: '🤷',
}

export function VerdictPill({ code, big = false }: { code: VerdictCode; big?: boolean }) {
  return (
    <span
      title={VERDICT_HINT[code]}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full ring-1 ring-inset',
        big ? 'px-3.5 py-1.5 text-base font-semibold' : 'px-2.5 py-0.5 text-xs font-medium',
        PILL[code]
      )}
    >
      {big && <span aria-hidden>{EMOJI[code]}</span>}
      {VERDICT_LABEL[code]}
    </span>
  )
}
