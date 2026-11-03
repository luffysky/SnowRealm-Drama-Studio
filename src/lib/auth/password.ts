import { hash as argonHash, verify as argonVerify, type Algorithm } from '@node-rs/argon2'
import bcrypt from 'bcryptjs'

/**
 * Password hashing. Argon2id is the only algorithm used for *new* hashes;
 * bcrypt verification is retained so accounts created before the switch can
 * still sign in and be migrated transparently.
 *
 * Nothing in this module logs, returns, or persists a plaintext password, and
 * an old hash is never "converted" — a bcrypt hash can only be replaced by
 * re-hashing the plaintext the user just supplied at login.
 *
 * Requires the Node.js runtime: @node-rs/argon2 is a native module and cannot
 * load on the Edge runtime. Every route that calls this sets
 * `export const runtime = 'nodejs'`.
 */

/**
 * `Algorithm.Argon2id`. Written as a typed literal because the package exports
 * `Algorithm` as a `const enum`, which `isolatedModules` forbids importing as
 * a value. The unit tests assert the produced hash really starts with
 * `$argon2id$`, so this cannot drift unnoticed.
 */
const ARGON2ID = 2 as Algorithm

/** OWASP-recommended Argon2id parameters, set explicitly so a change in the library's defaults cannot silently weaken them. */
export const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  /** KiB of memory per hash. */
  memoryCost: 19456,
  /** Iterations. */
  timeCost: 2,
  parallelism: 1,
} as const

export type HashAlgorithm = 'argon2id' | 'bcrypt' | 'unknown'

/** Identifies an existing hash by its prefix, without needing the plaintext. */
export function algorithmOf(hash: string): HashAlgorithm {
  if (hash.startsWith('$argon2id$')) return 'argon2id'
  // bcrypt revisions in the wild: 2, 2a, 2b, 2x, 2y.
  if (/^\$2[abxy]?\$/.test(hash)) return 'bcrypt'
  return 'unknown'
}

export async function hashPassword(plaintext: string): Promise<string> {
  return argonHash(plaintext, ARGON2_OPTIONS)
}

/**
 * Verifies against whichever algorithm produced the stored hash.
 * Returns false rather than throwing on a malformed or unknown hash, so a
 * corrupt row cannot turn a failed login into a 500.
 */
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  if (!hash) return false

  try {
    switch (algorithmOf(hash)) {
      case 'argon2id':
        return await argonVerify(hash, plaintext, ARGON2_OPTIONS)
      case 'bcrypt':
        return await bcrypt.compare(plaintext, hash)
      default:
        return false
    }
  } catch {
    return false
  }
}

/**
 * Whether this hash should be replaced after a successful login: it is bcrypt,
 * or it is Argon2id computed with weaker parameters than the current policy.
 *
 * Call this only after `verifyPassword` returned true — rehashing needs the
 * verified plaintext.
 */
export function needsRehash(hash: string): boolean {
  const algorithm = algorithmOf(hash)
  if (algorithm === 'bcrypt') return true
  if (algorithm === 'unknown') return false

  const params = parseArgonParams(hash)
  if (!params) return true

  return (
    params.memoryCost < ARGON2_OPTIONS.memoryCost ||
    params.timeCost < ARGON2_OPTIONS.timeCost ||
    params.parallelism !== ARGON2_OPTIONS.parallelism
  )
}

/** Reads `m=`, `t=` and `p=` out of a PHC-format Argon2 hash string. */
export function parseArgonParams(
  hash: string
): { memoryCost: number; timeCost: number; parallelism: number } | null {
  const match = /\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(hash)
  if (!match) return null

  return {
    memoryCost: Number(match[1]),
    timeCost: Number(match[2]),
    parallelism: Number(match[3]),
  }
}

/**
 * Minimum length for the two studio accounts.
 *
 * Eight is lower than a public service should accept. It is set here because
 * this is a closed two-person tool with no registration route, where the real
 * defence against guessing is the login rate limiter in `rate-limit.ts` rather
 * than entropy — and because a bar the members route around by writing the
 * password on a note is worse than a shorter one they remember.
 */
export const PASSWORD_MIN_LENGTH = 8

/**
 * Minimum bar for the two studio accounts. Deliberately length-led —
 * composition rules do less for a two-person private tool than length does.
 */
export function describePasswordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `密碼至少需要 ${PASSWORD_MIN_LENGTH} 個字元`
  }
  if (/^\s|\s$/.test(password)) {
    return '密碼開頭或結尾不可為空白'
  }
  if (/^(.)\1+$/.test(password)) {
    return '密碼不可為單一重複字元'
  }
  return null
}
