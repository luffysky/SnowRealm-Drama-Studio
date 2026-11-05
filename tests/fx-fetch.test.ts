import { describe, expect, it } from 'vitest'
import { parseLiveRates, sameRates } from '@/lib/fx-fetch'
import { convert, CURRENCIES, type FxRates } from '@/lib/money'

/**
 * 每天自動抓匯率 (Z150).
 *
 * 這份測試盯的是**驗證**，不是抓取。理由：驗證寫鬆了不會報錯，只會在某一天
 * 把一組壞匯率存進去，然後每一筆錢都錯而且看起來正常——成本中心照樣顯示、
 * 照樣加總、照樣畫預算條。
 *
 * 手填那版就是這樣壞掉的：`base: 'CNY'` 配上 `{CNY: 0.22, TWD: 1}`，一張以
 * 台幣為基準的表貼上人民幣的標籤，1 美金變成 1.47 人民幣。
 */

const GOOD = {
  result: 'success',
  base_code: 'TWD',
  time_last_update_utc: 'Thu, 05 Nov 2026 00:02:31 +0000',
  rates: { TWD: 1, USD: 0.030465, CNY: 0.2029 },
}

describe('解析供應商的匯率', () => {
  it('收下正常的回應', () => {
    const out = parseLiveRates(GOOD)
    expect(out.ok).toBe(true)
    if (!out.ok) return

    expect(out.rates.base).toBe('TWD')
    expect(out.rates.rates.USD).toBeCloseTo(0.030465)
    expect(out.rates.asOf).toBe('2026-11-05')
    expect(out.rates.source).toContain('open.er-api.com')
  })

  /** 基準對自己只能是 1——手填那版正是栽在這裡。 */
  it('基準對自己不是 1 就不收', () => {
    const bad = { ...GOOD, base_code: 'CNY', rates: { CNY: 0.22, TWD: 1, USD: 0.15 } }
    const out = parseLiveRates(bad)

    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toContain('不是 1')
  })

  it('三種幣別缺一個就不收', () => {
    const out = parseLiveRates({ ...GOOD, rates: { TWD: 1, USD: 0.030465 } })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('CNY')
  })

  it('零、負數、非數字都不收', () => {
    for (const usd of [0, -1, 'abc', null, Infinity, NaN]) {
      const out = parseLiveRates({ ...GOOD, rates: { ...GOOD.rates, USD: usd } })
      expect(out.ok).toBe(false)
    }
  })

  /**
   * 擋的是「這個回應根本不是匯率」，不是在追求精準。
   *
   * 真實匯率一年動幾個百分點，不會變成十倍。所以十倍寬到不可能誤殺，又窄到
   * 抓得住明顯的垃圾。
   */
  it('離譜的數字不收', () => {
    const silly = parseLiveRates({ ...GOOD, rates: { ...GOOD.rates, USD: 900 } })
    expect(silly.ok).toBe(false)

    const tiny = parseLiveRates({ ...GOOD, rates: { ...GOOD.rates, CNY: 0.0000001 } })
    expect(tiny.ok).toBe(false)
  })

  it('合理的波動照收', () => {
    // 比基準值高兩成，那是正常的一年。
    const moved = parseLiveRates({ ...GOOD, rates: { TWD: 1, USD: 0.037, CNY: 0.24 } })
    expect(moved.ok).toBe(true)
  })

  it('供應商自己說失敗就不收', () => {
    const out = parseLiveRates({ ...GOOD, result: 'error' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('供應商')
  })

  it('不是物件、沒有 rates、基準是沒聽過的幣別，都不收', () => {
    expect(parseLiveRates(null).ok).toBe(false)
    expect(parseLiveRates('hello').ok).toBe(false)
    expect(parseLiveRates({ base_code: 'TWD' }).ok).toBe(false)
    expect(parseLiveRates({ ...GOOD, base_code: 'JPY' }).ok).toBe(false)
  })

  it('沒有更新時間就用今天，不要空白', () => {
    const { time_last_update_utc: _omitted, ...withoutDate } = GOOD
    const out = parseLiveRates(withoutDate, new Date('2026-11-09T00:00:00Z'))

    expect(out.ok).toBe(true)
    if (out.ok) expect(out.rates.asOf).toBe('2026-11-09')
  })
})

/* -------------------------------------------------------------------------- */
/* 三種幣別兩兩換算                                                            */
/* -------------------------------------------------------------------------- */

describe('台幣、美金、人民幣三者互換', () => {
  const fx = (parseLiveRates(GOOD) as { ok: true; rates: FxRates }).rates

  it('每一種都換得到另外兩種', () => {
    for (const from of CURRENCIES) {
      for (const to of CURRENCIES) {
        expect(() => convert(100, from, to, fx)).not.toThrow()
        expect(convert(100, from, to, fx)).toBeGreaterThan(0)
      }
    }
  })

  /** 換過去再換回來要回得到原值，否則某一邊的方向寫反了。 */
  it('來回換算不走鐘', () => {
    for (const from of CURRENCIES) {
      for (const to of CURRENCIES) {
        const round = convert(convert(1000, from, to, fx), to, from, fx)
        expect(round).toBeCloseTo(1000, 6)
      }
    }
  })

  it('換出來的數字對得上常識', () => {
    // 1 美金約 6–8 人民幣，約 28–35 台幣。
    expect(convert(1, 'USD', 'CNY', fx)).toBeGreaterThan(6)
    expect(convert(1, 'USD', 'CNY', fx)).toBeLessThan(8)
    expect(convert(1, 'USD', 'TWD', fx)).toBeGreaterThan(28)
    expect(convert(1, 'USD', 'TWD', fx)).toBeLessThan(35)
  })
})

describe('一樣就不要重寫', () => {
  const a = (parseLiveRates(GOOD) as { ok: true; rates: FxRates }).rates

  it('同一組視為相同', () => {
    expect(sameRates(a, { ...a })).toBe(true)
  })

  it('base 換了就不同', () => {
    expect(sameRates(a, { ...a, base: 'USD' })).toBe(false)
  })

  it('任何一個數字動了就不同', () => {
    expect(sameRates(a, { ...a, rates: { ...a.rates, CNY: 0.21 } })).toBe(false)
  })
})
