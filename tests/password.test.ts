import bcrypt from 'bcryptjs'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  ARGON2_OPTIONS,
  algorithmOf,
  describePasswordProblem,
  hashPassword,
  needsRehash,
  parseArgonParams,
  verifyPassword,
} from '@/lib/auth/password'

/**
 * Covers the Argon2id switch and the transparent bcrypt migration.
 * No test here writes a plaintext password anywhere but a local variable.
 */

beforeAll(() => {
  process.env.AUTH_SECRET ??= 'test-secret-value-at-least-32-chars-long'
  process.env.DATABASE_URL ??= 'postgresql://localhost:5432/test'
})

const PLAINTEXT = 'a-perfectly-usable-passphrase'

describe('native binary loads', () => {
  it('produces a hash, which proves @node-rs/argon2 resolved its platform binary', async () => {
    const hash = await hashPassword(PLAINTEXT)
    expect(hash).toBeTypeOf('string')
    expect(hash.length).toBeGreaterThan(50)
  })
})

describe('Argon2id parameters', () => {
  it('uses the agreed parameters', () => {
    expect(ARGON2_OPTIONS.memoryCost).toBe(19456)
    expect(ARGON2_OPTIONS.timeCost).toBe(2)
    expect(ARGON2_OPTIONS.parallelism).toBe(1)
  })

  it('writes argon2id — not argon2i or argon2d — into the hash', async () => {
    const hash = await hashPassword(PLAINTEXT)
    expect(hash.startsWith('$argon2id$')).toBe(true)
  })

  it('encodes the parameters in the hash so they can be audited later', async () => {
    const hash = await hashPassword(PLAINTEXT)
    expect(parseArgonParams(hash)).toEqual({
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    })
  })

  it('salts randomly, so the same password hashes differently each time', async () => {
    const a = await hashPassword(PLAINTEXT)
    const b = await hashPassword(PLAINTEXT)
    expect(a).not.toBe(b)
    expect(await verifyPassword(PLAINTEXT, a)).toBe(true)
    expect(await verifyPassword(PLAINTEXT, b)).toBe(true)
  })

  it('never embeds the plaintext in the hash', async () => {
    const hash = await hashPassword(PLAINTEXT)
    expect(hash).not.toContain(PLAINTEXT)
  })
})

describe('verification', () => {
  it('accepts the right password and rejects the wrong one', async () => {
    const hash = await hashPassword(PLAINTEXT)
    expect(await verifyPassword(PLAINTEXT, hash)).toBe(true)
    expect(await verifyPassword('not-the-password', hash)).toBe(false)
  })

  it('still verifies legacy bcrypt hashes', async () => {
    const legacy = await bcrypt.hash(PLAINTEXT, 12)
    expect(algorithmOf(legacy)).toBe('bcrypt')
    expect(await verifyPassword(PLAINTEXT, legacy)).toBe(true)
    expect(await verifyPassword('wrong', legacy)).toBe(false)
  })

  it('returns false instead of throwing on a malformed or empty hash', async () => {
    expect(await verifyPassword(PLAINTEXT, '')).toBe(false)
    expect(await verifyPassword(PLAINTEXT, 'not-a-hash-at-all')).toBe(false)
    expect(await verifyPassword(PLAINTEXT, '$argon2id$truncated')).toBe(false)
  })
})

describe('algorithm detection', () => {
  it('identifies each format', async () => {
    expect(algorithmOf(await hashPassword(PLAINTEXT))).toBe('argon2id')
    expect(algorithmOf(await bcrypt.hash(PLAINTEXT, 10))).toBe('bcrypt')
    expect(algorithmOf('$2a$12$abcdefghijklmnopqrstuv')).toBe('bcrypt')
    expect(algorithmOf('$2y$12$abcdefghijklmnopqrstuv')).toBe('bcrypt')
    expect(algorithmOf('plaintext-oh-no')).toBe('unknown')
  })
})

describe('rehash policy', () => {
  it('flags every bcrypt hash for migration', async () => {
    expect(needsRehash(await bcrypt.hash(PLAINTEXT, 12))).toBe(true)
    expect(needsRehash(await bcrypt.hash(PLAINTEXT, 10))).toBe(true)
  })

  it('leaves a current Argon2id hash alone', async () => {
    expect(needsRehash(await hashPassword(PLAINTEXT))).toBe(false)
  })

  it('flags an Argon2id hash computed with weaker parameters', () => {
    const weak = '$argon2id$v=19$m=4096,t=1,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA'
    expect(needsRehash(weak)).toBe(true)
  })

  it('does not flag a stronger hash — raising cost elsewhere must not force a downgrade', () => {
    const stronger = '$argon2id$v=19$m=65536,t=4,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA'
    expect(needsRehash(stronger)).toBe(false)
  })

  it('does not try to migrate something it cannot identify', () => {
    expect(needsRehash('garbage')).toBe(false)
  })
})

describe('migration produces a working Argon2id hash', () => {
  it('replaces bcrypt with argon2id that verifies the same password', async () => {
    // Exactly the login path: verify against bcrypt, then rehash the plaintext.
    const legacy = await bcrypt.hash(PLAINTEXT, 12)

    expect(await verifyPassword(PLAINTEXT, legacy)).toBe(true)
    expect(needsRehash(legacy)).toBe(true)

    const migrated = await hashPassword(PLAINTEXT)

    expect(algorithmOf(migrated)).toBe('argon2id')
    expect(await verifyPassword(PLAINTEXT, migrated)).toBe(true)
    expect(await verifyPassword('wrong', migrated)).toBe(false)
    expect(needsRehash(migrated)).toBe(false)

    // The new hash is derived from the plaintext, never from the old hash.
    expect(migrated).not.toContain(legacy.slice(7, 30))
  })
})

describe('password policy', () => {
  it('rejects weak passwords', () => {
    expect(describePasswordProblem('short')).toMatch(/至少/)
    expect(describePasswordProblem('aaaaaaaaaaaa')).toMatch(/重複/)
    expect(describePasswordProblem(' leadingspace1')).toMatch(/空白/)
  })

  it('accepts a reasonable one', () => {
    expect(describePasswordProblem(PLAINTEXT)).toBeNull()
  })
})
