import { describe, expect, it } from 'vitest'
import {
  BASE_CURRENCY,
  CURRENCIES,
  conversionNote,
  convert,
  DEFAULT_FX,
  formatFromBase,
  formatMoney,
  isCurrency,
} from '@/lib/money'

/**
 * Pure unit tests — no database. The point of this module is that a number
 * never appears next to the wrong symbol, which is exactly the bug it was
 * written to fix.
 */

describe('formatMoney', () => {
  it('never renders TWD as a bare $', () => {
    // Intl under zh-TW formats TWD as `$`, indistinguishable from USD.
    expect(formatMoney(1234, 'TWD')).toBe('NT$1,234')
    expect(formatMoney(1234, 'TWD')).not.toBe('$1,234')
  })

  it('uses the customary number of decimals per currency', () => {
    expect(formatMoney(1234.5, 'TWD')).toBe('NT$1,235')
    expect(formatMoney(1234.5, 'USD')).toBe('US$1,234.50')
    expect(formatMoney(1234.5, 'CNY')).toBe('CN¥1,234.50')
  })

  it('formats zero rather than falling back to a dash', () => {
    expect(formatMoney(0, 'TWD')).toBe('NT$0')
    expect(formatMoney(0, 'USD')).toBe('US$0.00')
  })
})

describe('convert', () => {
  it('returns the amount untouched when the currencies match', () => {
    for (const code of CURRENCIES) {
      expect(convert(123.45, code, code)).toBe(123.45)
    }
  })

  it('round-trips without drifting', () => {
    const there = convert(1000, 'TWD', 'USD')
    const back = convert(there, 'USD', 'TWD')
    expect(back).toBeCloseTo(1000, 6)
  })

  it('converts a NT$3,000 cap to roughly US$93, not US$3,000', () => {
    const usd = convert(3000, 'TWD', 'USD')
    expect(usd).toBeGreaterThan(50)
    expect(usd).toBeLessThan(200)
  })

  it('throws rather than silently yielding 0 when a rate is missing', () => {
    const broken = { ...DEFAULT_FX, rates: { ...DEFAULT_FX.rates, USD: 0 } }
    expect(() => convert(100, 'TWD', 'USD', broken)).toThrow(/匯率/)
  })
})

describe('formatFromBase', () => {
  it('leaves a base-currency figure unconverted', () => {
    expect(formatFromBase(500, BASE_CURRENCY)).toBe(formatMoney(500, BASE_CURRENCY))
  })

  it('converts and labels in one step', () => {
    expect(formatFromBase(3000, 'USD')).toMatch(/^US\$/)
  })
})

describe('conversionNote', () => {
  it('is absent for the base currency, because nothing was converted', () => {
    expect(conversionNote(BASE_CURRENCY)).toBeNull()
  })

  it('states the rate and its date whenever a figure was converted', () => {
    const note = conversionNote('USD')
    expect(note).toContain(DEFAULT_FX.asOf)
    expect(note).toContain('US$')
  })
})

describe('isCurrency', () => {
  it('accepts the supported codes and rejects anything else', () => {
    for (const code of CURRENCIES) expect(isCurrency(code)).toBe(true)
    for (const bad of ['JPY', 'twd', '', null, 42]) expect(isCurrency(bad)).toBe(false)
  })
})
