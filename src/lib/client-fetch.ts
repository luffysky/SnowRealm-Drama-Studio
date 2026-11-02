'use client'

/**
 * Browser-side fetch that carries the CSRF token.
 *
 * Every mutating request must send `x-csrf-token` matching the `srds_csrf`
 * cookie (see src/lib/auth/csrf.ts). Centralising it here means a new call site
 * cannot forget — which would surface as a confusing 403 rather than an
 * obvious bug.
 */

const CSRF_COOKIE = 'srds_csrf'
const CSRF_HEADER = 'x-csrf-token'

export function readCsrfToken(): string {
  if (typeof document === 'undefined') return ''
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${CSRF_COOKIE}=`))
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : ''
}

/** `fetch`, with the CSRF header attached to state-changing methods. */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const needsToken = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)

  const headers = new Headers(init.headers)
  if (needsToken && !headers.has(CSRF_HEADER)) {
    headers.set(CSRF_HEADER, readCsrfToken())
  }

  return fetch(input, { ...init, headers })
}

/** Reads the API's error envelope, falling back to the status code. */
export async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    return body.error?.message ?? `請求失敗（${response.status}）`
  } catch {
    return `請求失敗（${response.status}）`
  }
}
