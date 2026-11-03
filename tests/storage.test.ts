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

describe('buildObjectKey', () => {
  it('groups by project, original-vs-derived, kind, then episode', async () => {
    const { buildObjectKey } = await import('@/lib/r2')

    const key = buildObjectKey({
      projectId: 'p1',
      kind: 'IMAGE',
      filename: 'scene.png',
      episodeNumber: 7,
    })

    expect(key.startsWith('projects/p1/originals/image/ep007/')).toBe(true)
    expect(key.endsWith('.png')).toBe(true)
  })

  it('files project-level assets under _project', async () => {
    const { buildObjectKey } = await import('@/lib/r2')

    const key = buildObjectKey({ projectId: 'p1', kind: 'MUSIC', filename: 'theme.mp3' })

    expect(key).toContain('/originals/music/_project/')
  })

  it('keeps derived files out of the originals tree', async () => {
    /*
     * `preview/` used to sit beside `image/` and `video/`, which made a
     * machine-generated thumbnail look like another kind of asset.
     */
    const { buildDerivedKey } = await import('@/lib/r2')

    const key = buildDerivedKey({ projectId: 'p1', kind: 'waveform', extension: '.json' })

    expect(key.startsWith('projects/p1/derived/waveform/')).toBe(true)
    expect(key).not.toContain('/originals/')
  })

  it('neutralises a filename that tries to escape its folder', async () => {
    const { slugForKey } = await import('@/lib/r2')

    // Removed rather than escaped: a key with no slashes cannot traverse.
    expect(slugForKey('../../etc/passwd.png')).toBe('etc-passwd')
    expect(slugForKey('a/b/c.png')).toBe('a-b-c')
    expect(slugForKey('....//evil.png')).toBe('evil')
  })

  it('keeps CJK, which is the whole point of a readable key here', async () => {
    const { slugForKey } = await import('@/lib/r2')

    expect(slugForKey('《一灶見山河》主題曲.mp3')).toBe('一灶見山河-主題曲')
  })

  it('produces a usable key when the name survives nothing', async () => {
    const { buildObjectKey, slugForKey } = await import('@/lib/r2')

    // Emoji and punctuation reduce to nothing; the UUID still carries it.
    expect(slugForKey('🎬🎬🎬.mp4')).toBe('')

    const key = buildObjectKey({ projectId: 'p1', kind: 'VIDEO', filename: '🎬.mp4' })
    expect(key).toMatch(/\/[0-9a-f-]{36}\.mp4$/)
  })
})
