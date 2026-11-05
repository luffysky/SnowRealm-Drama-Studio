import { describe, expect, it } from 'vitest'
import { budgetState, periodOf, splitLedger, type LedgerRow } from '@/lib/costs'
import { fxRatesSchema } from '@/lib/validators'
import { convert } from '@/lib/money'

/**
 * 成本中心 (Z90).
 *
 * 這裡釘的兩件事有同一個性質：**算錯的時候畫面看起來一模一樣**。錢的頁面
 * 只要是數字就像數字，沒有任何地方會喊。
 */

/* -------------------------------------------------------------------------- */
/* 估算與結算不可以重複計算                                                    */
/* -------------------------------------------------------------------------- */

describe('用量帳分成已實際與已承諾', () => {
  /**
   * `usage_ledger` 每一筆花費躺兩列：排隊時一列 ESTIMATE，結算時一列 ACTUAL，
   * 用 `settles_id` 指回去。直接 `sum(amount)` 會把同一筆錢算兩次。
   *
   * 實測這個工作室的資料：9 筆估算 $1.676 加 11 筆結算 $1.620，天真加總是
   * $3.30，實際只花了 $1.98。**差 66%，而兩個數字都像錢。**
   */
  it('被結算掉的估算不再算進已承諾', () => {
    const rows: LedgerRow[] = [
      { id: 'e1', kind: 'ESTIMATE', settlesId: null, amount: 1 },
      { id: 'a1', kind: 'ACTUAL', settlesId: 'e1', amount: 0.9 },
    ]

    const { actual, committed } = splitLedger(rows)

    expect(actual).toBeCloseTo(0.9)
    expect(committed).toBe(0)
    // 天真加總會是 1.9，那是同一筆錢算了兩次。
    expect(actual + committed).not.toBeCloseTo(1.9)
  })

  it('還沒結算的估算算進已承諾', () => {
    const rows: LedgerRow[] = [
      { id: 'e1', kind: 'ESTIMATE', settlesId: null, amount: 1 },
      { id: 'e2', kind: 'ESTIMATE', settlesId: null, amount: 2 },
      { id: 'a1', kind: 'ACTUAL', settlesId: 'e1', amount: 0.8 },
    ]

    const { actual, committed } = splitLedger(rows)

    expect(actual).toBeCloseTo(0.8)
    expect(committed).toBeCloseTo(2)
  })

  /** 沒有對應估算的結算（例如直接記的用量）照樣要算進實際。 */
  it('孤兒結算不會被漏掉', () => {
    const { actual } = splitLedger([{ id: 'a1', kind: 'ACTUAL', settlesId: null, amount: 5 }])
    expect(actual).toBe(5)
  })

  it('空的帳本是零，不是 NaN', () => {
    expect(splitLedger([])).toEqual({ actual: 0, committed: 0 })
  })
})

describe('分組與預算狀態', () => {
  it('月份用本地時間算，補零', () => {
    expect(periodOf(new Date(2026, 0, 9))).toBe('2026-01')
    expect(periodOf(new Date(2026, 10, 5))).toBe('2026-11')
  })

  it('超過一百就是超支，不是警戒', () => {
    expect(budgetState(50, 80)).toBe('ok')
    expect(budgetState(85, 80)).toBe('warn')
    expect(budgetState(100, 80)).toBe('over')
    expect(budgetState(240, 80)).toBe('over')
  })
})

/* -------------------------------------------------------------------------- */
/* 匯率表必須自洽                                                              */
/* -------------------------------------------------------------------------- */

describe('匯率設定', () => {
  const good = {
    base: 'TWD' as const,
    rates: { TWD: 1, USD: 0.031, CNY: 0.22 },
    asOf: '2026-11-03',
    source: '手動輸入',
  }

  it('收下自洽的表', () => {
    expect(fxRatesSchema.safeParse(good).success).toBe(true)
  })

  /**
   * 這一條是從**真的存進資料庫的壞值**來的。
   *
   * 存著的是 `base: 'CNY'` 配上 `{CNY: 0.22, TWD: 1, USD: 0.15}`——一張以
   * 台幣為基準的表貼上人民幣的標籤。於是 1 美金換成 1.47 人民幣（實際約
   * 7.1），而成本中心照樣顯示、照樣加總、照樣畫預算條。
   */
  it('基準幣別對自己不是 1 就不給存', () => {
    const bad = { ...good, base: 'CNY' as const, rates: { CNY: 0.22, TWD: 1, USD: 0.15 } }
    const result = fxRatesSchema.safeParse(bad)

    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('基準幣別')
  })

  it('缺一種幣別就不給存', () => {
    const bad = { ...good, rates: { TWD: 1, USD: 0.031 } }
    expect(fxRatesSchema.safeParse(bad).success).toBe(false)
  })

  /** 自洽的表換算出來要對得上常識。 */
  it('自洽的表換算得出合理的數字', () => {
    // 1 美金 ≈ 7.1 人民幣：0.22 / 0.031。
    const cny = convert(1, 'USD', 'CNY', good)
    expect(cny).toBeGreaterThan(6)
    expect(cny).toBeLessThan(8)
  })
})
