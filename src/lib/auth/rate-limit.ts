import { and, count, desc, eq, gt, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { securityEvents } from '@/db/schema'

/**
 * Login rate limiting (spec v2 §6.3).
 *
 * Counts rows in `security_events` over a sliding window rather than keeping an
 * in-memory counter: on Vercel each request may land in a fresh instance, so an
 * in-process map would reset constantly and throttle nothing.
 *
 * Two independent limits apply — one per email address, so a single account
 * cannot be brute-forced, and a looser one per IP, so one client cannot sweep
 * many addresses. The IP limit is the looser of the two because both members
 * legitimately share one office address.
 *
 * A successful login resets the per-email count: failures are only counted from
 * the last success onwards. That keeps a user who mistyped several times from
 * sitting near the limit afterwards, without deleting any audit history.
 */

export const RATE_LIMIT = {
  windowMinutes: 15,
  maxPerEmail: 8,
  maxPerIp: 25,
} as const

/** Failures that count toward the limit. A success does not. */
const COUNTED = ['LOGIN_FAILED', 'LOGIN_RATE_LIMITED'] as const

export type RateLimitVerdict =
  | { limited: false }
  | {
      limited: true
      scope: 'email' | 'ip'
      /** Seconds the caller should wait, for the Retry-After header. */
      retryAfterSec: number
    }

/**
 * Checks both limits. Call before verifying a password, so a locked-out caller
 * never reaches the hash comparison.
 */
export async function checkLoginRateLimit(input: {
  email: string
  ipAddress: string
}): Promise<RateLimitVerdict> {
  const windowStart = new Date(Date.now() - RATE_LIMIT.windowMinutes * 60 * 1000)
  const retryAfterSec = RATE_LIMIT.windowMinutes * 60
  const email = input.email.trim().toLowerCase()

  if (email) {
    // Only failures since the most recent success count.
    const [lastSuccess] = await db
      .select({ at: securityEvents.createdAt })
      .from(securityEvents)
      .where(
        and(
          eq(securityEvents.email, email),
          eq(securityEvents.kind, 'LOGIN_SUCCESS'),
          gt(securityEvents.createdAt, windowStart)
        )
      )
      .orderBy(desc(securityEvents.createdAt))
      .limit(1)

    const countFrom =
      lastSuccess && lastSuccess.at > windowStart ? lastSuccess.at : windowStart

    const [row] = await db
      .select({ n: count() })
      .from(securityEvents)
      .where(
        and(
          eq(securityEvents.email, email),
          inArray(securityEvents.kind, [...COUNTED]),
          gt(securityEvents.createdAt, countFrom)
        )
      )

    if (Number(row?.n ?? 0) >= RATE_LIMIT.maxPerEmail) {
      return { limited: true, scope: 'email', retryAfterSec }
    }
  }

  if (input.ipAddress) {
    const [row] = await db
      .select({ n: count() })
      .from(securityEvents)
      .where(
        and(
          eq(securityEvents.ipAddress, input.ipAddress),
          inArray(securityEvents.kind, [...COUNTED]),
          gt(securityEvents.createdAt, windowStart)
        )
      )

    if (Number(row?.n ?? 0) >= RATE_LIMIT.maxPerIp) {
      return { limited: true, scope: 'ip', retryAfterSec }
    }
  }

  return { limited: false }
}

export type SecurityEventKind =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGIN_RATE_LIMITED'
  | 'LOGOUT'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_REHASHED'
  | 'SESSION_REVOKED'

/**
 * Appends a security event. Never receives or stores a password or a hash —
 * `detail` is a short machine-readable reason only.
 */
export async function recordSecurityEvent(input: {
  kind: SecurityEventKind
  userId?: string | null
  email?: string
  ipAddress?: string
  userAgent?: string
  detail?: string
}): Promise<void> {
  try {
    await db.insert(securityEvents).values({
      kind: input.kind,
      userId: input.userId ?? null,
      email: (input.email ?? '').trim().toLowerCase(),
      ipAddress: input.ipAddress ?? '',
      userAgent: (input.userAgent ?? '').slice(0, 300),
      detail: input.detail ?? '',
    })
  } catch (error) {
    // Auditing must not take the request down with it.
    console.error('[security] failed to record event:', error)
  }
}
