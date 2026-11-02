import crypto from 'node:crypto'
import { env } from './env'

/**
 * AES-256-GCM for secrets the studio stores at rest — currently AI provider
 * API keys (spec 48「金鑰僅後端加密保存，顯示遮罩」).
 *
 * The key comes from ENCRYPTION_KEY when set, otherwise it is derived from
 * AUTH_SECRET via HKDF with a fixed, non-secret info label. Deriving means the
 * two secrets stay independent even though one variable can supply both:
 * rotating AUTH_SECRET only invalidates sessions unless ENCRYPTION_KEY is
 * absent, which is documented in docs/ENVIRONMENT.md.
 */

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16

function key(): Buffer {
  const { ENCRYPTION_KEY, AUTH_SECRET } = env()

  if (ENCRYPTION_KEY) {
    // Accept either 32 raw bytes in base64/hex, or any string we stretch.
    const decoded = tryDecodeKey(ENCRYPTION_KEY)
    if (decoded) return decoded
  }

  return Buffer.from(
    crypto.hkdfSync('sha256', ENCRYPTION_KEY ?? AUTH_SECRET, '', 'srds:provider-key:v1', 32)
  )
}

function tryDecodeKey(value: string): Buffer | null {
  for (const encoding of ['base64url', 'base64', 'hex'] as const) {
    try {
      const buf = Buffer.from(value, encoding)
      if (buf.length === 32) return buf
    } catch {
      /* try the next encoding */
    }
  }
  return null
}

/** Returns `iv.ciphertext.tag`, each segment base64url. */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGO, key(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join('.')
}

/** Throws if the payload was tampered with or the key changed. */
export function decryptSecret(payload: string): string {
  const parts = payload.split('.')
  if (parts.length !== 3) {
    throw new Error('Malformed ciphertext')
  }
  const [ivPart, dataPart, tagPart] = parts as [string, string, string]

  const iv = Buffer.from(ivPart, 'base64url')
  const ciphertext = Buffer.from(dataPart, 'base64url')
  const tag = Buffer.from(tagPart, 'base64url')

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Malformed ciphertext')
  }

  const decipher = crypto.createDecipheriv(ALGO, key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/** Last four characters of a secret, for masked display. Never the whole key. */
export function last4(secret: string): string {
  return secret.length <= 4 ? '****' : secret.slice(-4)
}

/** Constant-time string compare, for comparing opaque tokens. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}
