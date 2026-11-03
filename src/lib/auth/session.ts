import { and, eq, gt, isNull } from 'drizzle-orm'
import { jwtVerify, SignJWT } from 'jose'
import { cookies, headers } from 'next/headers'
import { db } from '@/db'
import { sessions, users } from '@/db/schema'
import { env } from '@/lib/env'
import type { RoleValue } from '@/lib/constants'
import { isCurrency, type CurrencyValue } from '@/lib/money'

export const SESSION_COOKIE = 'srds_session'
const SESSION_TTL_DAYS = 30
const ISSUER = 'snowrealm-drama-studio'

export type SessionUser = {
  id: string
  email: string
  name: string
  title: string
  role: RoleValue
  color: string
  /** Which currency this member reads money in. Display only. */
  displayCurrency: CurrencyValue
}

type TokenPayload = {
  /** sessions.id — lets a single session be revoked server-side. */
  sid: string
  sub: string
}

function secret(): Uint8Array {
  return new TextEncoder().encode(env().AUTH_SECRET)
}

function expiry(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
}

/**
 * Creates a session row plus the signed cookie that points at it.
 *
 * The cookie carries only the session id, so revoking a session (spec 49)
 * takes effect immediately without rotating AUTH_SECRET for both members.
 */
export async function createSession(
  userId: string,
  meta: { userAgent?: string; ipAddress?: string } = {}
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const expiresAt = expiry()

  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      userAgent: (meta.userAgent ?? '').slice(0, 300),
      ipAddress: meta.ipAddress ?? '',
      expiresAt,
    })
    .returning({ id: sessions.id })

  if (!row) throw new Error('Failed to create session')

  const token = await new SignJWT({ sid: row.id, sub: userId } satisfies TokenPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret())

  return { token, sessionId: row.id, expiresAt }
}

/** Verifies the JWT signature only. Does not check revocation. */
export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER })
    if (typeof payload.sid !== 'string' || typeof payload.sub !== 'string') return null
    return { sid: payload.sid, sub: payload.sub }
  } catch {
    return null
  }
}

/**
 * Resolves the cookie to a live user: valid signature, session row not expired
 * and not revoked, and the user still active. Returns null otherwise.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null

  const payload = await verifyToken(token)
  if (!payload) return null

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      title: users.title,
      role: users.role,
      color: users.color,
      displayCurrency: users.displayCurrency,
      active: users.active,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, payload.sid),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date())
      )
    )
    .limit(1)

  if (!row || !row.active) return null

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    title: row.title,
    role: row.role,
    color: row.color,
    // A hand-edited column must not break every page; fall back to the base.
    displayCurrency: isCurrency(row.displayCurrency) ? row.displayCurrency : 'TWD',
  }
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies()
  const headerList = await headers()

  /*
   * `secure` follows the real protocol, matching the CSRF cookie's rule.
   * Vercel always sets `x-forwarded-proto: https`, so production is unaffected;
   * locally over plain HTTP the header is absent and the cookie is accepted,
   * which is what makes `next start` usable on a LAN address.
   */
  const isHttps = headerList.get('x-forwarded-proto') === 'https'

  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
}

/** Revokes the current session row and clears the cookie. */
export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value

  if (token) {
    const payload = await verifyToken(token)
    if (payload) {
      await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.id, payload.sid))
    }
  }

  store.delete(SESSION_COOKIE)
}

/** Revokes one session by id, but only if it belongs to `userId`. */
export async function revokeSession(sessionId: string, userId: string): Promise<boolean> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id })

  return rows.length > 0
}

/** Bumps `lastSeenAt` so the device list shows recent activity. */
export async function touchSession(sessionId: string): Promise<void> {
  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, sessionId))
}
