import { NextResponse } from 'next/server'
import { handle, jsonOk, newRequestId } from '@/lib/api'
import { runDueJobs } from '@/lib/ai/queue'
import { safeEqual } from '@/lib/crypto'

/**
 * Background worker for the AI queue (spec v2 §6.6).
 *
 * Invoked by Vercel Cron on a schedule (see vercel.json) and safe to invoke
 * concurrently: claiming uses `FOR UPDATE SKIP LOCKED`, so two overlapping runs
 * take different jobs.
 *
 * Authorisation is **not** a user session — a cron invocation has no cookies.
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; requests without it
 * are rejected, so the endpoint cannot be used by anyone else to burn API
 * credit.
 */
export const runtime = 'nodejs'

/**
 * Give the worker room for a long generation. Vercel caps this by plan, and a
 * value above the plan limit is clamped rather than rejected.
 */
export const maxDuration = 300

export const dynamic = 'force-dynamic'

function authorize(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET

  // Without a configured secret the endpoint stays closed rather than open.
  if (!secret) {
    return NextResponse.json(
      {
        error: {
          code: 'not_configured',
          message: 'CRON_SECRET 未設定，worker 已停用。見 docs/ENVIRONMENT.md',
          requestId: newRequestId(),
        },
      },
      { status: 503 }
    )
  }

  const header = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`

  if (!safeEqual(header, expected)) {
    return NextResponse.json(
      {
        error: {
          code: 'unauthorized',
          message: '需要有效的 cron 憑證',
          requestId: newRequestId(),
        },
      },
      { status: 401 }
    )
  }

  return null
}

export const GET = handle(async (request: Request) => {
  const denied = authorize(request)
  if (denied) return denied

  const limit = Number(new URL(request.url).searchParams.get('limit') ?? 2)
  const report = await runDueJobs({ limit: Math.min(Math.max(limit, 1), 5) })

  return jsonOk(report)
})

/** Same work as GET; lets the queue dialog nudge the worker after enqueueing. */
export const POST = GET
