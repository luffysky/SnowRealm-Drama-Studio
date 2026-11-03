import { describe, expect, it } from 'vitest'
import { planParts, R2_LIMITS } from '@/lib/r2'

/**
 * Multipart planning (`docs/STORAGE.md` §5).
 *
 * R2 refuses an upload with more than 10,000 parts. A fixed part size turns
 * that into a silent ceiling: the upload starts, runs for an hour, and fails
 * somewhere in the middle. These pin the arithmetic that avoids it.
 */

const MB = 1024 * 1024
const GB = 1024 * MB

describe('planParts', () => {
  it('keeps small parts for ordinary files', () => {
    // More, smaller parts mean a failed part is cheap to retry — which is the
    // common case on a home connection.
    const plan = planParts(500 * MB)

    expect(plan.partSize).toBe(16 * MB)
    expect(plan.totalParts).toBe(Math.ceil((500 * MB) / (16 * MB)))
  })

  it('never exceeds the 10,000-part limit, however large the file', () => {
    for (const size of [100 * GB, 500 * GB, 1024 * GB, 4000 * GB]) {
      const plan = planParts(size)

      expect(plan.totalParts).toBeLessThanOrEqual(R2_LIMITS.maxParts)
      expect(plan.partSize).toBeLessThanOrEqual(R2_LIMITS.maxPartSizeBytes)
      // The parts must actually cover the file.
      expect(plan.partSize * plan.totalParts).toBeGreaterThanOrEqual(size)
    }
  })

  it('grows the part size only once the fixed size would overflow', () => {
    // 10,000 x 16 MB = 160 GB is the point where scaling has to start.
    const under = planParts(150 * GB)
    const over = planParts(200 * GB)

    expect(under.partSize).toBe(16 * MB)
    expect(over.partSize).toBeGreaterThan(16 * MB)
  })

  it('always plans at least one part', () => {
    expect(planParts(0).totalParts).toBe(1)
    expect(planParts(1).totalParts).toBe(1)
  })

  it('rounds the part size to a whole MB', () => {
    const plan = planParts(1234 * GB)

    expect(plan.partSize % MB).toBe(0)
  })
})
