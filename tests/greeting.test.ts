import { describe, expect, it } from 'vitest'
import { greetingZh } from '@/app/(studio)/dashboard/page'

/**
 * The greeting renders on the server, where the clock is UTC. These pin the
 * Taipei conversion: without it, 20:00 in Taipei reads as 12:00 UTC and the
 * dashboard says 午安 to someone sitting down after dinner.
 */
describe('greetingZh', () => {
  const at = (iso: string) => greetingZh(new Date(iso))

  it('reads the hour in Taipei, not in UTC', () => {
    // 12:00 UTC is 20:00 in Taipei.
    expect(at('2026-11-04T12:00:00Z')).toBe('晚安')
    // 23:00 UTC is 07:00 the next morning in Taipei.
    expect(at('2026-11-04T23:00:00Z')).toBe('早安')
  })

  it('covers each band', () => {
    expect(at('2026-11-03T18:30:00Z')).toBe('夜深了') // 02:30 Taipei
    expect(at('2026-11-04T01:00:00Z')).toBe('早安') // 09:00
    expect(at('2026-11-04T04:00:00Z')).toBe('午安') // 12:00
    expect(at('2026-11-04T07:00:00Z')).toBe('午後好') // 15:00
    expect(at('2026-11-04T11:00:00Z')).toBe('晚安') // 19:00
  })

  it('treats Taipei midnight as hour 0, not hour 24', () => {
    // `hour12: false` reports midnight as 24, which falls past every band.
    expect(at('2026-11-03T16:00:00Z')).toBe('夜深了') // 00:00 Taipei
  })
})
