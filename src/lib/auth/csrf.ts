import crypto from 'node:crypto'
import { cookies } from 'next/headers'
import { ApiError } from '@/lib/api'
import { safeEqual } from '@/lib/crypto'

/**
 * CSRF protection (spec v2 §6.3).
 *
 * Two independent checks, because each covers a case the other misses:
 *
 * 1. **Origin / Referer** — rejects a cross-site form post outright. This is
 *    the check that actually stops the classic attack, since a browser will not
 *    let script on another origin forge these headers.
 * 2. **Double-submit token** — a readable `srds_csrf` cookie whose value must
 *    be echoed in the `x-csrf-token` header. Script on another origin cannot
 *    read the cookie, so it cannot produce the header.
 *
 * The session cookie is already `SameSite=Lax`, which blocks cross-site POST in
 * current browsers; this layer is what keeps the app safe where that is not
 * enough — an older browser, or a same-site subdomain that gets compromised.
 *
 * The CSRF cookie is deliberately **not** httpOnly: the whole point is that
 * first-party script can read it. It carries no authority on its own — it only
 * proves the caller can read a cookie from this origin.
 */

export const CSRF_COOKIE = 'srds_csrf'
export const CSRF_HEADER = 'x-csrf-token'

const TOKEN_BYTES = 32

/** Methods that change state and therefore need a token. */
const PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function generateCsrfToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url')
}

/**
 * Reads the current token. The cookie itself is minted by `src/middleware.ts`,
 * because Next.js only permits setting a cookie from middleware, a Route
 * Handler or a Server Action — never during a Server Component render.
 */
export async function readCsrfCookie(): Promise<string | null> {
  const store = await cookies()
  return store.get(CSRF_COOKIE)?.value ?? null
}

/** Hosts a request may legitimately originate from. */
function allowedOrigins(request: Request): string[] {
  const host = request.headers.get('host')
  const forwardedHost = request.headers.get('x-forwarded-host')
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'

  const origins: string[] = []
  for (const h of [forwardedHost, host]) {
    if (!h) continue
    origins.push(`${proto}://${h}`)
    origins.push(`http://${h}`)
    origins.push(`https://${h}`)
  }
  return origins
}

/**
 * Throws 403 when a state-changing request fails either check.
 * Safe methods pass through untouched.
 */
export async function assertCsrf(request: Request): Promise<void> {
  if (!PROTECTED_METHODS.has(request.method.toUpperCase())) return

  /*
   * A request carrying an `Authorization` header cannot be a CSRF attack: a
   * browser never attaches that header on its own, so forging one would
   * require script on this origin — which already has the token anyway.
   *
   * This is what lets Vercel Cron call the worker with a bearer secret and no
   * cookies, while the same endpoint still enforces the token for the
   * session-authenticated nudge from the app.
   */
  if (request.headers.get('authorization')) return

  // --- 1. Origin / Referer -------------------------------------------------
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')
  const allowed = allowedOrigins(request)

  if (origin) {
    if (!allowed.includes(origin)) {
      throw ApiError.forbidden('請求來源不被允許（CSRF 防護）')
    }
  } else if (referer) {
    // Some clients omit Origin; fall back to the Referer's origin.
    let refererOrigin: string
    try {
      refererOrigin = new URL(referer).origin
    } catch {
      throw ApiError.forbidden('請求來源格式不正確（CSRF 防護）')
    }
    if (!allowed.includes(refererOrigin)) {
      throw ApiError.forbidden('請求來源不被允許（CSRF 防護）')
    }
  }
  // Neither header present: a non-browser client. The token check below still
  // applies, so this does not create a hole.

  // --- 2. Double-submit token ---------------------------------------------
  const store = await cookies()
  const cookieToken = store.get(CSRF_COOKIE)?.value
  const headerToken = request.headers.get(CSRF_HEADER)

  if (!cookieToken) {
    throw ApiError.forbidden('缺少 CSRF cookie，請重新整理頁面後再試')
  }
  if (!headerToken) {
    throw ApiError.forbidden(`缺少 ${CSRF_HEADER} 標頭（CSRF 防護）`)
  }
  if (!safeEqual(headerToken, cookieToken)) {
    throw ApiError.forbidden('CSRF token 不符，請重新整理頁面後再試')
  }
}

/**
 * No path-based exemptions exist.
 *
 * There used to be one for `/api/ai/worker`, on the grounds that Vercel Cron
 * sends no cookies. That became too broad once a signed-in member could also
 * call the worker: the whole path was skipping the check, not just the cron
 * caller. The `Authorization`-header rule in `assertCsrf` covers the cron case
 * precisely, so an exemption list is no longer needed — and an endpoint can no
 * longer lose CSRF protection just by being added to a list.
 */
