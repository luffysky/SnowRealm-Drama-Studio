import { TASK_EFFORT, TASK_MAX_TOKENS } from './prompts'
import type { AiTaskKind } from './types'

/**
 * 一次呼叫用哪一種思考程度、多少輸出額度 (Z157).
 *
 * 抽成純函式是因為**這條鏈斷過，而且沒有任何東西會發現**。
 *
 * Z22 做了 `TASK_EFFORT`：潤稿是局部修改、大綱主要是照格式走，讓它們想很久
 * 只是在燒 token 跟時間，所以每個任務配一個適合的程度。那張表寫好了、註解
 * 寫得很清楚、標成完成。
 *
 * 然後 `enqueueJob` 寫了這一行：
 *
 *     effort: input.effort ?? 'high'
 *
 * 而介面從來不送 effort。所以每一個進佇列的任務都被蓋上 `'high'`，而
 * `request.effort` 在適配器的優先序裡排第一——**`TASK_EFFORT` 從上線那天起
 * 就沒有被讀到過一次**，系統設定裡那張任務設定表也一樣。
 *
 * 這就是「小說轉劇本每次都失敗」的真正原因：它被強制在 high 思考，而
 * `max_tokens` 在 adaptive thinking 底下是思考加正文的總額，於是 8000 全花
 * 在思考上，一個字都沒寫出來。
 *
 * 這種錯不會報錯。它只是讓一張表安靜地失效，而畫面上每一個數字看起來都正
 * 常。所以這兩條規則現在是純函式，而且有測試盯著優先序。
 */

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * 思考程度，由高到低的優先序：
 *
 *  1. 這一次請求明確指定的
 *  2. 系統設定裡這個任務的設定
 *  3. `TASK_EFFORT` 的內建判斷
 *  4. `high`
 *
 * 第一項**只有真的指定時才算**。`undefined` 跟 `null` 都是「沒指定」——
 * 佇列那一行把「沒指定」存成 `'high'`，正是整條鏈斷掉的地方。
 */
export function resolveEffort(input: {
  task: AiTaskKind
  requested?: Effort | null
  profile?: Effort | null
}): Effort {
  return input.requested ?? input.profile ?? TASK_EFFORT[input.task] ?? 'high'
}

/**
 * 輸出額度，同一套優先序。
 *
 * 要注意這是**思考加正文的總額**（adaptive thinking），不是正文的額度。一個
 * 會寫出整份文件的任務配一個太小的總額，結果不是「輸出被截斷」而是「完全沒
 * 有輸出」——模型把額度花在思考上就停了。
 *
 * 零與負數當成沒指定：一個存成 0 的設定會讓每一次呼叫都立刻失敗，而那個 0
 * 看起來只是一個數字。
 */
export function resolveMaxTokens(input: {
  task: AiTaskKind
  requested?: number | null
  profile?: number | null
  fallback: number
}): number {
  const candidates = [input.requested, input.profile, TASK_MAX_TOKENS[input.task]]
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value)
    }
  }
  return input.fallback
}
