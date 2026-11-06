import type { AiJobKindValue } from '@/lib/constants'

/**
 * 一個任務的產出，採用時該寫到哪裡去 (Z30).
 *
 * ## 為什麼要有這張表，而不是每個畫面各寫一次
 *
 * 同一個任務有**兩個**發動點：編輯器的面板，與批次生成。而
 * `enqueueJob` 存下來的 `targetType` 是之後 `applyCandidate` 唯一的依據——
 * 所以兩個發動點各填各的，就會出現「從編輯器跑的採用得了、從批次跑的採用不
 * 了」這種只有試了才知道的差別。
 *
 * 批次那邊本來是寫死的 `targetType: ''`，理由寫著「Nothing in this app
 * writes AI output into a document without somebody looking at it first
 * (Z123)」。**那個理由不成立**：`targetType` 不會讓任何東西自動寫入，它只說
 * 「人按下採用之後要寫到哪」。任務照樣停在 `AWAITING_REVIEW`，收件匣照樣要
 * 求先看過全文才給按採用。空字串換來的不是安全，是**批次產出的東西沒有一樣
 * 套用得了**——而批次存在的理由正是「不要為了十五集開十五次編輯器」。
 *
 * 這一條不是只影響這次做的改編：`STORYBOARD_GENERATE` 也在 `BATCH_TASKS`
 * 裡，所以批次產生的分鏡在這之前一樣是採用了什麼都不會建。
 *
 * ## 為什麼只有兩個
 *
 * 只收「目標能從 `job.episodeId` 自己推出來」的任務。`OUTLINE_GENERATE` 的
 * 目標是一份 document，而 `applyCandidate` 的 document 分支要 `targetId`，
 * 批次給不出來（它只知道集數）——硬填一個 targetType 卻沒有 targetId，會讓
 * 採用安靜地什麼都不做，正是這張表要消滅的東西。
 *
 * 分析類（`SCRIPT_ANALYZE`、`NOVEL_REVIEW`）**刻意沒有目標**。它們的產出是
 * 給人讀的意見，不是要覆蓋任何東西。
 */
const APPLY_TARGETS: Partial<Record<AiJobKindValue, string>> = {
  NOVEL_TO_SCRIPT: 'episode_scenes',
  STORYBOARD_GENERATE: 'episode_shots',
}

/** 空字串代表「採用不會自動寫回任何地方」，那是 `ai_jobs.target_type` 的預設值。 */
export function applyTargetFor(task: AiJobKindValue): string {
  return APPLY_TARGETS[task] ?? ''
}
