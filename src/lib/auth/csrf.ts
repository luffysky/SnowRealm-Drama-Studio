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
 * Routes that legitimately cannot carry a token.
 *
 * The AI worker is called by Vercel Cron, which has no cookies at all; it is
 * authorised by its own bearer secret instead, so applying CSRF there would
 * simply break it without adding protection.
 */
export const CSRF_EXEMPT_PATHS = ['/api/ai/worker'] as const

export function isCsrfExempt(pathname: string): boolean {
  return CSRF_EXEMPT_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}
