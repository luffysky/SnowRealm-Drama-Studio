import { describe, expect, it } from 'vitest'
import { resolveEffort, resolveMaxTokens } from '@/lib/ai/budget'
import { TASK_EFFORT, TASK_MAX_TOKENS } from '@/lib/ai/prompts'

/**
 * 思考程度與輸出額度的優先序 (Z157).
 *
 * 「小說轉劇本每次都失敗」追到底是這一行：
 *
 *     effort: input.effort ?? 'high'      // enqueueJob
 *
 * 介面從來不送 effort，所以每一個進佇列的任務都被蓋上 `'high'`——而
 * `request.effort` 在優先序裡排第一。於是 Z22 做的 `TASK_EFFORT`（潤稿 low、
 * 大綱 medium）跟系統設定那張表，**兩個都從來沒有被讀到過一次**。
 *
 * Z22 在待辦表上是打勾的。它沒有修好。
 *
 * 這種錯不會報錯，也不會有畫面變醜——它只是讓一張表安靜地失效。所以優先序
 * 現在是純函式，而這份測試盯的就是那四層的順序，以及「沒指定」不可以被當成
 * 一個值。
 */

describe('思考程度的優先序', () => {
  it('這一次指定的最大', () => {
    expect(
      resolveEffort({ task: 'NOVEL_POLISH', requested: 'high', profile: 'low' })
    ).toBe('high')
  })

  it('沒指定就看系統設定', () => {
    expect(
      resolveEffort({ task: 'NOVEL_POLISH', requested: null, profile: 'high' })
    ).toBe('high')
  })

  it('系統設定也沒有，才用每個任務的內建判斷', () => {
    // 潤稿是局部修改，想很久只是在燒 token（Z22）。
    expect(resolveEffort({ task: 'NOVEL_POLISH' })).toBe('low')
    // 審稿與一致性檢查正好相反：想久一點才找得到矛盾。
    expect(resolveEffort({ task: 'NOVEL_REVIEW' })).toBe('high')
    expect(resolveEffort({ task: 'NOVEL_TO_SCRIPT' })).toBe('medium')
  })

  it('undefined 跟 null 都是「沒指定」，不可以蓋掉後面的', () => {
    /*
     * 這一條就是那個 bug 的形狀。佇列把「沒指定」存成 `'high'`，於是後面三
     * 層永遠輪不到。存 null、傳 null，才會往下走。
     */
    expect(resolveEffort({ task: 'NOVEL_POLISH', requested: null })).toBe('low')
    expect(resolveEffort({ task: 'NOVEL_POLISH', requested: undefined })).toBe('low')
    expect(resolveEffort({ task: 'NOVEL_POLISH', profile: null })).toBe('low')
  })

  it('每一種任務都有內建判斷，沒有一種會掉到 high 這個保底', () => {
    /*
     * 保底存在是為了不要在新增任務種類的時候炸掉，不是拿來用的。掉到保底
     * 代表有人加了任務卻沒想過它要想多久——而 high 是最貴的那個。
     */
    for (const [task, effort] of Object.entries(TASK_EFFORT)) {
      expect(resolveEffort({ task: task as keyof typeof TASK_EFFORT })).toBe(effort)
    }
  })
})

describe('輸出額度的優先序', () => {
  it('這一次指定的最大，然後是系統設定，然後是每個任務的內建值', () => {
    expect(
      resolveMaxTokens({ task: 'NOVEL_TO_SCRIPT', requested: 9000, profile: 5000, fallback: 8000 })
    ).toBe(9000)
    expect(
      resolveMaxTokens({ task: 'NOVEL_TO_SCRIPT', requested: null, profile: 5000, fallback: 8000 })
    ).toBe(5000)
    expect(resolveMaxTokens({ task: 'NOVEL_TO_SCRIPT', fallback: 8000 })).toBe(
      TASK_MAX_TOKENS.NOVEL_TO_SCRIPT
    )
  })

  it('沒有內建值的任務吃全域預設', () => {
    expect(resolveMaxTokens({ task: 'NOVEL_POLISH', fallback: 8000 })).toBe(8000)
  })

  it('零、負數與 NaN 當成沒指定', () => {
    /*
     * 一個存成 0 的設定會讓每一次呼叫都立刻失敗，而那個 0 在設定頁上看起來
     * 只是一個數字。寧可忽略它，也不要讓它變成一個沒有人看得懂的錯誤。
     */
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveMaxTokens({ task: 'NOVEL_POLISH', requested: bad, fallback: 8000 })).toBe(8000)
    }
  })

  it('會寫出整份文件的任務，額度要比全域預設大', () => {
    /*
     * 這就是 Z157 的症狀：`max_tokens` 在 adaptive thinking 底下是**思考加
     * 正文的總額**，所以一個要寫出整份劇本的任務配 8000，結果是思考花光額
     * 度、一個字都沒寫——而且照樣收錢（實測 in 4810 / out 8000、零內容）。
     */
    const DEFAULT = 8000
    for (const task of ['NOVEL_TO_SCRIPT', 'NOVEL_CONTINUE', 'STORYBOARD_GENERATE'] as const) {
      expect(resolveMaxTokens({ task, fallback: DEFAULT })).toBeGreaterThan(DEFAULT)
    }
  })

  it('額度不會高到讓 60 秒的 worker 必然超時', () => {
    // 超時的請求是「已經付錢但拿不到東西」——跟它要修的 bug 同一種結果。
    for (const value of Object.values(TASK_MAX_TOKENS)) {
      expect(value).toBeLessThanOrEqual(16_000)
    }
  })
})
