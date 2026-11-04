import { describe, expect, it } from 'vitest'
import {
  END_MARKER_SOURCE,
  endMarkerOf,
  hasEndMarker,
  markerMismatch,
} from '@/lib/novel-progress'

/**
 * 一集寫完了沒有（Z118）。
 *
 * 判斷依據是作者自己在正文最後寫的「第001集 完」，不是字數百分比。
 * 一章寫到目標字數的 110% 也可能還差半場戲；寫到 60% 也可能就是收了。
 * 百分比回答得了「寫了多少」，回答不了「寫完了嗎」。
 */

/** 這五段是《一灶見山河》正文真正的結尾，不是我編的。 */
const REAL_ENDINGS = [
  { number: 1, text: '「只要還有一口鍋，就還能重新開始。」\n\n第001集 完' },
  { number: 2, text: '沈知味屏住呼吸，緩緩伸出手。\n\n第002集 完' },
  { number: 3, text: '而這名男子，正是許山河。\n\n第003集 完' },
  { number: 4, text: '「終於找到了。」\n\n第004集 完' },
  { number: 5, text: '再次站在了彼此面前。\n\n第005集 完' },
]

describe('endMarkerOf', () => {
  it('認得出真正的五集結尾', () => {
    for (const ending of REAL_ENDINGS) {
      const marker = endMarkerOf(ending.text)
      expect(marker, `EP${ending.number}`).not.toBeNull()
      expect(marker?.number, `EP${ending.number}`).toBe(ending.number)
    }
  })

  it('空格可有可無', () => {
    expect(endMarkerOf('正文。\n第001集完')?.number).toBe(1)
    expect(endMarkerOf('正文。\n第 1 集 完')?.number).toBe(1)
  })

  it('「本集完」「全文完」也算', () => {
    expect(hasEndMarker('正文。\n本集完')).toBe(true)
    expect(hasEndMarker('正文。\n全文完')).toBe(true)
    expect(endMarkerOf('正文。\n本集完')?.number).toBeNull()
  })

  it('「完結」也算', () => {
    expect(hasEndMarker('正文。\n第003集 完結')).toBe(true)
  })

  it('還沒寫完就沒有標記', () => {
    expect(hasEndMarker('沈知味屏住呼吸，緩緩伸出手。')).toBe(false)
    expect(hasEndMarker('')).toBe(false)
  })

  /* ---- 以下是不該誤判的 ---- */

  it('標記出現在中間不算收尾', () => {
    /*
     * 後面還有字，就表示這一集還沒停在那裡——可能是引用、可能是貼錯。
     * 不錨在結尾的話，一句引用就會讓整集被標成完成。
     */
    const text = '上一集結尾是「第001集 完」這樣寫的。\n\n然後這一集繼續往下。'
    expect(hasEndMarker(text)).toBe(false)
  })

  it('只有一個「完」字不算', () => {
    // 「完了」「完成」這種字到處都是，單看一個字會誤判到爆。
    expect(hasEndMarker('她心想，這下完了。')).toBe(false)
    expect(hasEndMarker('正文。\n完')).toBe(false)
  })

  it('結尾後面的空白不影響', () => {
    expect(hasEndMarker('正文。\n第002集 完\n\n   ')).toBe(true)
  })
})

describe('markerMismatch', () => {
  it('集號對得上就沒事', () => {
    for (const ending of REAL_ENDINGS) {
      expect(markerMismatch(ending.text, ending.number)).toBeNull()
    }
  })

  it('集號對不上會被指出來', () => {
    // 第五集結尾寫著「第004集 完」是貼錯，用讀的不會發現。
    expect(markerMismatch('正文。\n第004集 完', 5)).toBe(4)
  })

  it('沒有集號的標記不算對不上', () => {
    expect(markerMismatch('正文。\n本集完', 5)).toBeNull()
  })
})

describe('END_MARKER_SOURCE', () => {
  it('跟 TypeScript 用的那條規則認得出同樣的東西', () => {
    /*
     * 同一條規則有兩份實作（這裡一份、stage-sync 的 SQL 一份），而漂移是
     * 無聲的——其中一份會默默不再把集數標成完成。所以 pattern 只定義一次，
     * 這裡確認它在 JS 的方言裡也真的能用。
     */
    const asJs = new RegExp(
      // String.raw，否則 '\s' 很容易在編輯或貼上的過程中掉一個反斜線。
      END_MARKER_SOURCE.replaceAll('[[:space:]]', String.raw`\s`)
    )
    for (const ending of REAL_ENDINGS) {
      expect(asJs.test(ending.text.trimEnd()), `EP${ending.number}`).toBe(true)
    }
    expect(asJs.test('沈知味屏住呼吸，緩緩伸出手。')).toBe(false)
  })
})
