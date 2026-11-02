import { NextResponse } from 'next/server'
import { handle, jsonOk, newRequestId } from '@/lib/api'
import { runDueJobs } from '@/lib/ai/queue'
import { getSessionUser } from '@/lib/auth/session'
import { safeEqual } from '@/lib/crypto'

/**
 * Background worker for the AI queue (spec v2 §6.6).
 *
 * Two callers are allowed, because the Vercel Hobby plan fires cron at most
 * once per day — far too slow to be the only trigger:
 *
 * 1. **Vercel Cron**, authenticated by `Authorization: Bearer $CRON_SECRET`.
 *    This is the nightly sweep that picks up jobs whose retry backoff expired
 *    while nobody was using the app.
 * 2. **A signed-in member**, authenticated by their session. The client nudges
 *    this endpoint right after enqueueing so work starts immediately. That is
 *    safe: anyone who can reach it can already create the jobs it runs, so it
 *    grants no capability they did not have.
 *
 * Anonymous callers are rejected either way, so the endpoint can never be used
 * by a stranger to burn API credit.
 *
 * Safe to invoke concurrently — claiming uses `FOR UPDATE SKIP LOCKED`, so two
 * overlapping runs take different jobs.
 */
export const runtime = 'nodejs'

/**
 * Vercel Hobby caps a serverless function at 60s (Pro allows up to 300s).
 * Asking for more than the plan permits fails the deployment, so this stays at
 * the Hobby ceiling. It also bounds how much a single invocation attempts:
 * see `limit` below.
 */
export const maxDuration = 60

export const dynamic = 'force-dynamic'

function unauthorized(message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: { code: status === 503 ? 'not_configured' : 'unauthorized', message, requestId: newRequestId() } },
    { status }
  )
}

/** Cron bearer token, or a logged-in member. Returns null when authorised. */
async function authorize(request: Request): Promise<NextResponse | null> {
  const header = request.headers.get('authorization') ?? ''

  if (header.startsWith('Bearer ')) {
    const secret = process.env.CRON_SECRET
    if (!secret) {
      // Fail closed: without a configured secret the cron path stays shut.
      return unauthorized('CRON_SECRET 未設定，排程觸發已停用。見 docs/ENVIRONMENT.md', 503)
    }
    if (!safeEqual(header, `Bearer ${secret}`)) {
      return unauthorized('cron 憑證不正確', 401)
    }
    return null
  }

  const user = await getSessionUser()
  if (!user) {
    return unauthorized('需要有效的 cron 憑證或登入工作階段', 401)
  }

  return null
}

export const GET = handle(async (request: Request) => {
  const denied = await authorize(request)
  if (denied) return denied

  /*
   * Default of 1 keeps a single invocation inside the 60s budget: one long
   * generation can take most of it, and a run that is killed mid-flight leaves
   * the job's lease to expire before anything retries it. The nightly cron
   * asks for more, since it has the whole queue to clear.
   */
  const requested = Number(new URL(request.url).searchParams.get('limit') ?? 1)
  const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 1, 1), 5)

  const report = await runDueJobs({ limit })
  return jsonOk(report)
})

/** Same work as GET; this is the verb the client nudge uses. */
export const POST = GET
