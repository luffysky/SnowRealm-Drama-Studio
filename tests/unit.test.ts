import { beforeAll, describe, expect, it } from 'vitest'
import { diffLines, diffStats } from '@/lib/diff'
import { roleCan, isDestructive, PERMISSIONS } from '@/lib/auth/rbac'
import { ASSET_KINDS, EPISODE_STATUSES } from '@/lib/constants'
import {
  PRODUCTION_STAGE_KEYS,
  PRODUCTION_STAGE_LABEL,
  PRODUCTION_STAGE_STATUSES,
} from '@/lib/production'
import { buildObjectKey, extensionOf, planParts, shouldUseMultipart } from '@/lib/r2'
import { decryptSecret, encryptSecret, last4, safeEqual } from '@/lib/crypto'
import {
  clamp,
  countChars,
  estimateScriptSeconds,
  formatBytes,
  formatDuration,
  formatDurationZh,
  judgeDuration,
  slugify,
  stageCompletion,
} from '@/lib/utils'
import { episodeBatchSchema, expenseSchema, shotSchema, uploadRequestSchema } from '@/lib/validators'

beforeAll(() => {
  // crypto.ts reads AUTH_SECRET through the validated env.
  process.env.AUTH_SECRET ??= 'test-secret-value-at-least-32-chars-long'
  process.env.DATABASE_URL ??= 'postgresql://localhost:5432/test'
})

describe('formatting', () => {
  it('formats runtimes as m:ss', () => {
    expect(formatDuration(150)).toBe('2:30')
    expect(formatDuration(59)).toBe('0:59')
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(-5)).toBe('0:00')
  })

  it('formats runtimes in Chinese', () => {
    expect(formatDurationZh(150)).toBe('2 分 30 秒')
    expect(formatDurationZh(120)).toBe('2 分')
    expect(formatDurationZh(45)).toBe('45 秒')
  })

  it('formats byte sizes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 * 1024 * 3.5)).toBe('3.5 MB')
  })

  it('counts characters excluding whitespace', () => {
    expect(countChars('一灶見山河')).toBe(5)
    expect(countChars('一灶 見\n山河')).toBe(5)
    expect(countChars('')).toBe(0)
  })

  it('slugifies while keeping CJK readable', () => {
    expect(slugify('萬家燈火')).toBe('萬家燈火')
    expect(slugify('Hello World!')).toBe('hello-world')
    expect(slugify('   ')).toBe('untitled')
  })
})

describe('episode duration rules', () => {
  it('judges a storyboard against the 120–180s target', () => {
    expect(judgeDuration(150, 120, 180)).toEqual({ verdict: 'ok', deltaSec: 0 })
    expect(judgeDuration(100, 120, 180)).toEqual({ verdict: 'under', deltaSec: -20 })
    expect(judgeDuration(200, 120, 180)).toEqual({ verdict: 'over', deltaSec: 20 })
  })

  it('treats the bounds as inclusive', () => {
    expect(judgeDuration(120, 120, 180).verdict).toBe('ok')
    expect(judgeDuration(180, 120, 180).verdict).toBe('ok')
  })

  it('counts action and cuts, not just dialogue', () => {
    const dialogueOnly = estimateScriptSeconds({ dialogueChars: 500, actionChars: 0 })
    const withAction = estimateScriptSeconds({ dialogueChars: 500, actionChars: 600 })
    expect(withAction).toBeGreaterThan(dialogueOnly)

    const withCuts = estimateScriptSeconds({
      dialogueChars: 500,
      actionChars: 600,
      shotCount: 30,
    })
    expect(withCuts).toBeGreaterThan(withAction)
  })

  it('computes stage completion', () => {
    expect(stageCompletion([])).toBe(0)
    expect(
      stageCompletion([{ state: 'DONE' }, { state: 'DONE' }, { state: 'TODO' }, { state: 'DOING' }])
    ).toBe(0.5)
  })

  it('clamps', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
  })
})

describe('permissions', () => {
  it('lets OWNER do everything', () => {
    for (const permission of PERMISSIONS) {
      expect(roleCan('OWNER', permission)).toBe(true)
    }
  })

  it('withholds the restricted set from COLLABORATOR', () => {
    expect(roleCan('COLLABORATOR', 'document.write')).toBe(true)
    expect(roleCan('COLLABORATOR', 'asset.upload')).toBe(true)
    expect(roleCan('COLLABORATOR', 'ai.run')).toBe(true)

    expect(roleCan('COLLABORATOR', 'project.delete')).toBe(false)
    expect(roleCan('COLLABORATOR', 'member.manage')).toBe(false)
    expect(roleCan('COLLABORATOR', 'ai.provider.manage')).toBe(false)
  })

  it('flags irreversible operations', () => {
    expect(isDestructive('project.delete')).toBe(true)
    expect(isDestructive('asset.delete')).toBe(true)
    expect(isDestructive('document.write')).toBe(false)
  })
})

describe('secret encryption', () => {
  it('round-trips an API key', () => {
    const key = 'sk-ant-api03-not-a-real-key-0123456789'
    const ciphertext = encryptSecret(key)

    expect(ciphertext).not.toContain(key)
    expect(ciphertext.split('.')).toHaveLength(3)
    expect(decryptSecret(ciphertext)).toBe(key)
  })

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptSecret('same-value')
    const b = encryptSecret('same-value')
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe(decryptSecret(b))
  })

  it('rejects tampered ciphertext', () => {
    const ciphertext = encryptSecret('sensitive')
    const parts = ciphertext.split('.')
    const tampered = [parts[0], Buffer.from('evil').toString('base64url'), parts[2]].join('.')

    expect(() => decryptSecret(tampered)).toThrow()
    expect(() => decryptSecret('garbage')).toThrow('Malformed ciphertext')
  })

  it('masks to the last four characters only', () => {
    expect(last4('sk-ant-abcd1234')).toBe('1234')
    expect(last4('abc')).toBe('****')
  })

  it('compares in constant time without throwing on length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcdef')).toBe(false)
  })
})

describe('R2 object keys', () => {
  it('carries a readable, harmless fragment of the filename', () => {
    /*
     * This rule changed deliberately (2026-11-04). The key used to be UUID
     * only, which guaranteed three things: no collision, no traversal, no
     * leaked title. The first two still hold. The third was traded away so
     * that browsing the bucket answers "what is this file" without the
     * database — the console is where you look when something is wrong, and
     * two columns of UUIDs answer nothing.
     *
     * The trade is narrow: keys appear in presigned URLs, which are
     * short-lived and only minted for a member who can already download the
     * file itself.
     */
    const key = buildObjectKey({
      projectId: '11111111-1111-4111-8111-111111111111',
      kind: 'IMAGE',
      filename: '第7集 定妝照.png',
    })

    expect(key).toContain('定妝照')
    // Whitespace and punctuation still never survive into a key.
    expect(key).not.toContain(' ')
    expect(key).toMatch(
      /^projects\/11111111-1111-4111-8111-111111111111\/originals\/image\/_project\/[0-9a-f-]{36}__[^/]+\.png$/
    )
  })

  it('still cannot be escaped by a traversal filename', () => {
    // The part that must never regress: a key with no `..` and no extra
    // slashes cannot climb out of its prefix.
    const key = buildObjectKey({
      projectId: '11111111-1111-4111-8111-111111111111',
      kind: 'VIDEO',
      filename: '../../../etc/passwd.mp4',
    })

    expect(key).not.toContain('..')
    expect(
      key.startsWith('projects/11111111-1111-4111-8111-111111111111/originals/video/')
    ).toBe(true)

    // Exactly the segments the builder intends: nothing the filename added.
    expect(key.split('/')).toHaveLength(6)
  })

  it('groups by episode when one is known', () => {
    const key = buildObjectKey({
      projectId: '11111111-1111-4111-8111-111111111111',
      kind: 'VIDEO',
      filename: 'take.mp4',
      episodeNumber: 7,
    })

    expect(key).toContain('/originals/video/ep007/')
  })

  it('extracts only safe extensions', () => {
    expect(extensionOf('a.PNG')).toBe('.png')
    expect(extensionOf('movie.final.mp4')).toBe('.mp4')
    expect(extensionOf('noextension')).toBe('')
    expect(extensionOf('weird.name!')).toBe('')
  })

  it('switches to multipart only above the threshold', () => {
    expect(shouldUseMultipart(1024)).toBe(false)
    expect(shouldUseMultipart(64 * 1024 * 1024)).toBe(false)
    expect(shouldUseMultipart(64 * 1024 * 1024 + 1)).toBe(true)
  })

  it('plans parts that cover the whole file', () => {
    const size = 100 * 1024 * 1024
    const { partSize, totalParts } = planParts(size)
    expect(totalParts * partSize).toBeGreaterThanOrEqual(size)
    expect((totalParts - 1) * partSize).toBeLessThan(size)
  })
})

describe('validators', () => {
  it('rejects an inverted episode range', () => {
    const result = episodeBatchSchema.safeParse({
      arcId: '11111111-1111-4111-8111-111111111111',
      from: 50,
      to: 10,
    })
    expect(result.success).toBe(false)
  })

  it('accepts a 1–120 batch', () => {
    const result = episodeBatchSchema.safeParse({
      arcId: '11111111-1111-4111-8111-111111111111',
      from: 1,
      to: 120,
    })
    expect(result.success).toBe(true)
  })

  it('bounds shot duration', () => {
    const base = { episodeId: '11111111-1111-4111-8111-111111111111' }
    expect(shotSchema.safeParse({ ...base, durationSec: 5 }).success).toBe(true)
    expect(shotSchema.safeParse({ ...base, durationSec: 0 }).success).toBe(false)
    expect(shotSchema.safeParse({ ...base, durationSec: 999 }).success).toBe(false)
  })

  it('keeps money as an exact decimal string', () => {
    const parsed = expenseSchema.parse({
      projectId: '11111111-1111-4111-8111-111111111111',
      description: 'Claude API',
      amount: '12.3456',
      currency: 'usd',
    })
    expect(parsed.amount).toBe('12.3456')
    expect(parsed.currency).toBe('USD')

    expect(
      expenseSchema.safeParse({
        projectId: '11111111-1111-4111-8111-111111111111',
        description: 'x',
        amount: '12.345678',
        currency: 'USD',
      }).success
    ).toBe(false)
  })

  it('rejects an oversized upload', () => {
    const result = uploadRequestSchema.safeParse({
      projectId: '11111111-1111-4111-8111-111111111111',
      kind: 'VIDEO',
      filename: 'huge.mp4',
      sizeBytes: 50 * 1024 * 1024 * 1024,
    })
    expect(result.success).toBe(false)
  })
})

describe('diff', () => {
  it('reports added and removed lines', () => {
    const ops = diffLines('a\nb\nc', 'a\nx\nc')
    expect(diffStats(ops)).toEqual({ added: 1, removed: 1 })
    expect(ops.filter((o) => o.type === 'same').map((o) => o.text)).toEqual(['a', 'c'])
  })

  it('handles an empty original', () => {
    const ops = diffLines('', 'new line')
    expect(diffStats(ops).added).toBeGreaterThan(0)
  })

  it('reports no change for identical text', () => {
    const ops = diffLines('same\ntext', 'same\ntext')
    expect(diffStats(ops)).toEqual({ added: 0, removed: 0 })
  })
})

describe('enum vocabularies stay in sync with the UI', () => {
  it('covers the nine production stages, in pipeline order', () => {
    // spec v3 §11.2 fixes both the keys and their order.
    expect(PRODUCTION_STAGE_KEYS).toEqual([
      'story_planning',
      'novel',
      'script',
      'storyboard',
      'assets',
      'video',
      'postproduction',
      'review',
      'release',
    ])
  })

  it('names every stage', () => {
    for (const key of PRODUCTION_STAGE_KEYS) {
      expect(PRODUCTION_STAGE_LABEL[key]).toBeTruthy()
    }
    expect(PRODUCTION_STAGE_LABEL.story_planning).toBe('劇情規劃')
    expect(PRODUCTION_STAGE_LABEL.release).toBe('上架發布')
  })

  it('has a stage status for work that exists but is not accepted', () => {
    expect(PRODUCTION_STAGE_STATUSES).toContain('in_review')
    expect(PRODUCTION_STAGE_STATUSES).toContain('blocked')
  })

  it('includes every asset kind the spec names', () => {
    for (const kind of ['IMAGE', 'VIDEO', 'MUSIC', 'VOICE', 'NOVEL_ATTACHMENT', 'STICKER']) {
      expect(ASSET_KINDS).toContain(kind)
    }
  })

  it('has a status for every episode state', () => {
    expect(EPISODE_STATUSES).toContain('PLANNED')
    expect(EPISODE_STATUSES).toContain('DONE')
  })
})
