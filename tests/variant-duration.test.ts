import { describe, expect, it } from 'vitest'

/**
 * The arithmetic behind "a waveform knows the track's length".
 *
 * `finishVariantUpload` reads `durationSec` out of the variant's params, which
 * are whatever the browser wrote — so the guard has to survive a missing key,
 * a string, a NaN and a zero. Audio uploaded from 「新增檔案」 had a null
 * duration until this ran; a bad value here would replace one wrong answer
 * with a worse one.
 */
function durationFromParams(params: unknown): number | null {
  const value = Number((params as { durationSec?: unknown } | null)?.durationSec)
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null
}

describe('durationFromParams', () => {
  it('reads a real duration and rounds to whole seconds', () => {
    expect(durationFromParams({ durationSec: 23.998 })).toBe(24)
    expect(durationFromParams({ durationSec: 215.4 })).toBe(215)
  })

  it('refuses anything that is not a positive number', () => {
    expect(durationFromParams(null)).toBeNull()
    expect(durationFromParams({})).toBeNull()
    expect(durationFromParams({ durationSec: 0 })).toBeNull()
    expect(durationFromParams({ durationSec: -5 })).toBeNull()
    expect(durationFromParams({ durationSec: 'abc' })).toBeNull()
    expect(durationFromParams({ durationSec: Number.NaN })).toBeNull()
    expect(durationFromParams({ durationSec: Number.POSITIVE_INFINITY })).toBeNull()
  })

  it('accepts a numeric string, which is what JSON round-trips sometimes give', () => {
    expect(durationFromParams({ durationSec: '42.6' })).toBe(43)
  })
})
