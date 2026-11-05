import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { db } from '@/db'
import { activities } from '@/db/schema'
import { assertCsrf } from '@/lib/auth/csrf'
import { can, type Permission } from '@/lib/auth/rbac'
import { getSessionUser, type SessionUser } from '@/lib/auth/session'

/**
 * Shared plumbing for route handlers: one error shape, one place that decides
 * HTTP status, one place that enforces authentication.
 *
 * Every response carries a `requestId` (spec v2 §7) in both the body and the
 * `x-request-id` header, and the same id is written to the server log. A user
 * can quote the id from a failure and it can be found in the logs.
 */

import { ApiError } from '@/lib/api-error'

// 既有呼叫端都是 `from '@/lib/api'`，所以照樣從這裡出去。
export { ApiError } from '@/lib/api-error'

export type ApiErrorBody = {
  error: { code: string; message: string; requestId: string; details?: unknown }
}

export function newRequestId(): string {
  return crypto.randomUUID()
}

export function jsonOk<T>(data: T, init?: ResponseInit & { requestId?: string }) {
  const { requestId, ...rest } = init ?? {}
  const response = NextResponse.json(data, rest)
  if (requestId) response.headers.set('x-request-id', requestId)
  return response
}

export function jsonError(error: unknown, requestId: string): NextResponse<ApiErrorBody> {
  const headers = new Headers({ 'x-request-id': requestId })

  if (error instanceof ApiError) {
    for (const [key, value] of Object.entries(error.headers ?? {})) {
      headers.set(key, value)
    }
    // Client faults (4xx) are expected; only log the server's own failures.
    if (error.status >= 500) {
      console.error(`[api] ${requestId} ${error.code}: ${error.message}`)
    }
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          details: error.details,
        },
      },
      { status: error.status, headers }
    )
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: '輸入內容不正確',
          requestId,
          details: error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
      },
      { status: 422, headers }
    )
  }

  // Unexpected: log with the id the client is shown, return nothing internal.
  console.error(`[api] ${requestId} unhandled error:`, error)
  return NextResponse.json(
    { error: { code: 'internal_error', message: '伺服器發生錯誤', requestId } },
    { status: 500, headers }
  )
}

/**
 * Wraps a handler so thrown ApiError / ZodError become proper responses, and
 * every response gains a request id.
 *
 * CSRF is enforced here rather than per-route, so a new mutating endpoint is
 * protected by default — forgetting to opt in is the common way this check
 * gets bypassed.
 */
export function handle<Args extends unknown[]>(
  fn: (...args: Args) => Promise<NextResponse>
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    const requestId = newRequestId()
    try {
      const request = args[0]
      if (request instanceof Request) {
        await assertCsrf(request)
      }

      const response = await fn(...args)
      if (!response.headers.has('x-request-id')) {
        response.headers.set('x-request-id', requestId)
      }
      return response
    } catch (error) {
      return jsonError(error, requestId)
    }
  }
}

/** Throws 401 when there is no valid session. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) throw ApiError.unauthorized()
  return user
}

/** Throws 401 when unauthenticated, 403 when the role lacks `permission`. */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser()
  if (!can(user, permission)) {
    throw ApiError.forbidden(`此操作需要更高權限（${permission}）`)
  }
  return user
}

/** Appends an audit row. Failures here never break the request that caused them. */
export async function logActivity(entry: {
  user: Pick<SessionUser, 'id' | 'name'> | null
  action: string
  entityType: string
  entityId?: string | null
  projectId?: string | null
  summary?: string
  changes?: unknown
}): Promise<void> {
  try {
    await db.insert(activities).values({
      userId: entry.user?.id ?? null,
      userName: entry.user?.name ?? '',
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      projectId: entry.projectId ?? null,
      summary: entry.summary ?? '',
      changes: entry.changes === undefined ? null : entry.changes,
    })
  } catch (error) {
    console.error('[api] failed to write activity log:', error)
  }
}

/** Parses and validates a JSON body, turning malformed JSON into a 400. */
export async function parseJson<T>(
  request: Request,
  schema: { parse: (value: unknown) => T }
): Promise<T> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw ApiError.badRequest('請求內容不是有效的 JSON')
  }
  return schema.parse(raw)
}

/** Client IP from the proxy headers Vercel sets. */
export function clientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headers.get('x-real-ip') ??
    ''
  )
}
