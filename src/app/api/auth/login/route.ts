import crypto from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { db } from '@/db'
import { users } from '@/db/schema'
import { ApiError, clientIp, handle, jsonOk, logActivity, parseJson } from '@/lib/api'
import { hashPassword, needsRehash, verifyPassword } from '@/lib/auth/password'
import { checkLoginRateLimit, recordSecurityEvent } from '@/lib/auth/rate-limit'
import { createSession, setSessionCookie } from '@/lib/auth/session'
import { loginSchema } from '@/lib/validators'

/**
 * @node-rs/argon2 is a native module, so this route must run on the Node.js
 * runtime. It would fail to load on Edge.
 */
export const runtime = 'nodejs'

/**
 * Password login for the two studio accounts. There is no registration route,
 * no invitation flow and no OAuth — accounts exist only because `db:seed`
 * created them.
 *
 * On success, an account still on bcrypt is migrated to Argon2id using the
 * plaintext the user just supplied. The old hash is never converted, the
 * plaintext is never stored or logged, and the update is conditional on the
 * hash still being the one we verified, so two concurrent logins cannot
 * clobber each other.
 */
export const POST = handle(async (request: Request) => {
  const input = await parseJson(request, loginSchema)
  const headerList = await headers()

  const email = input.email.trim().toLowerCase()
  const ipAddress = clientIp(headerList)
  const userAgent = headerList.get('user-agent') ?? ''

  // Check the limiter before touching the password, so a locked-out caller
  // never reaches the hash comparison.
  const verdict = await checkLoginRateLimit({ email, ipAddress })
  if (verdict.limited) {
    await recordSecurityEvent({
      kind: 'LOGIN_RATE_LIMITED',
      email,
      ipAddress,
      userAgent,
      detail: `scope=${verdict.scope}`,
    })
    throw ApiError.rateLimited(
      `登入嘗試過於頻繁，請於 ${Math.ceil(verdict.retryAfterSec / 60)} 分鐘後再試。`,
      verdict.retryAfterSec
    )
  }

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      title: users.title,
      role: users.role,
      color: users.color,
      passwordHash: users.passwordHash,
      active: users.active,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  /*
   * Same message and comparable timing whether the address or the password was
   * wrong, so the response cannot be used to discover which accounts exist.
   * The dummy hash is a real Argon2id hash with the current parameters, so the
   * unknown-account path costs the same work as the wrong-password path.
   */
  const hashToCheck = user?.passwordHash ?? (await decoyHash())
  const ok = await verifyPassword(input.password, hashToCheck)

  if (!user || !ok) {
    await recordSecurityEvent({
      kind: 'LOGIN_FAILED',
      userId: user?.id ?? null,
      email,
      ipAddress,
      userAgent,
      detail: user ? 'bad_password' : 'unknown_account',
    })
    throw new ApiError(401, '帳號或密碼不正確', 'invalid_credentials')
  }

  if (!user.active) {
    await recordSecurityEvent({
      kind: 'LOGIN_FAILED',
      userId: user.id,
      email,
      ipAddress,
      userAgent,
      detail: 'inactive',
    })
    throw ApiError.forbidden('此帳號已停用')
  }

  // --- transparent migration to Argon2id --------------------------------
  let migrated = false
  if (needsRehash(user.passwordHash)) {
    const nextHash = await hashPassword(input.password)

    // Conditional update: only replace the exact hash we verified. If the other
    // member changed the password in between, this matches nothing and the
    // login still succeeds with the session below — we simply skip the rehash
    // rather than overwrite their change.
    const updated = await db
      .update(users)
      .set({ passwordHash: nextHash, updatedAt: new Date() })
      .where(and(eq(users.id, user.id), eq(users.passwordHash, user.passwordHash)))
      .returning({ id: users.id })

    migrated = updated.length > 0

    if (migrated) {
      await recordSecurityEvent({
        kind: 'PASSWORD_REHASHED',
        userId: user.id,
        email,
        ipAddress,
        userAgent,
        detail: 'bcrypt_to_argon2id',
      })
    }
  }

  const { token, expiresAt } = await createSession(user.id, { userAgent, ipAddress })
  await setSessionCookie(token, expiresAt)

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id))

  await recordSecurityEvent({
    kind: 'LOGIN_SUCCESS',
    userId: user.id,
    email,
    ipAddress,
    userAgent,
  })

  await logActivity({
    user: { id: user.id, name: user.name },
    action: 'login',
    entityType: 'user',
    entityId: user.id,
    summary: `${user.name} 登入`,
  })

  return jsonOk({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      title: user.title,
      role: user.role,
      color: user.color,
    },
    /** Surfaced for the smoke test; harmless to the client. */
    passwordUpgraded: migrated,
  })
})

/**
 * A genuine Argon2id hash of a random value, computed once per instance.
 *
 * Verifying against it when the account does not exist makes the unknown-account
 * path cost the same work as the wrong-password path. It is generated rather
 * than hard-coded so it always matches the current parameters, and so a
 * malformed literal can never short-circuit the comparison and reintroduce the
 * timing difference.
 */
let decoyHashPromise: Promise<string> | null = null

function decoyHash(): Promise<string> {
  decoyHashPromise ??= hashPassword(crypto.randomUUID())
  return decoyHashPromise
}
