import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 文字色階對比（WCAG AA）。
 *
 * ink-600 與 ink-700 本來是 2.50:1 與 1.74:1，兩者加起來撐著 283 個標籤、
 * 說明與計數，而且幾乎都是 10–11px——小字需要的對比比內文更高，不是更低。
 * 這組測試讓色階改回去會失敗。
 */

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ]
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(fg: string, bg: string): number {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function token(css: string, name: string): string {
  // `String.raw` so the backslashes survive into the pattern.
  const match = new RegExp(String.raw`--color-${name}:\s*(#[0-9a-f]{6})`, 'i').exec(css)
  if (!match?.[1]) throw new Error(`找不到色票 --color-${name}`)
  return match[1]
}

const css = readFileSync('src/app/globals.css', 'utf8')

describe('文字色階對比', () => {
  // The three panel backgrounds everything sits on.
  const backgrounds = ['stage-900', 'stage-850', 'stage-800'] as const

  it.each(['ink-50', 'ink-100', 'ink-200', 'ink-300', 'ink-400', 'ink-500', 'ink-600'])(
    '%s 在每個面板底色上都達到 AA 內文標準 4.5:1',
    (ink) => {
      for (const bg of backgrounds) {
        expect(contrast(token(css, ink), token(css, bg))).toBeGreaterThanOrEqual(4.5)
      }
    }
  )

  it('ink-700 至少達到大字／停用狀態的 3:1', () => {
    for (const bg of backgrounds) {
      expect(contrast(token(css, 'ink-700'), token(css, bg))).toBeGreaterThanOrEqual(3)
    }
  })

  it('色階仍然由亮到暗，階與階之間看得出差別', () => {
    const ladder = ['ink-300', 'ink-400', 'ink-500', 'ink-600', 'ink-700']
    const ratios = ladder.map((ink) => contrast(token(css, ink), token(css, 'stage-900')))

    for (let i = 1; i < ratios.length; i += 1) {
      const prev = ratios[i - 1]!
      const here = ratios[i]!
      expect(here).toBeLessThan(prev)
      // 兩階之間差太少就等於白分一階。
      expect(prev - here).toBeGreaterThan(0.5)
    }
  })
})
