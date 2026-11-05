import { NextResponse } from 'next/server'
import { handle, jsonOk, newRequestId } from '@/lib/api'
import { getSessionUser } from '@/lib/auth/session'
import { safeEqual } from '@/lib/crypto'
import { refreshFxRates } from '@/lib/fx-fetch'
import { reindexDirtyProjects } from '@/lib/search'

/**
 * Rebuilds the search index for projects whose content has moved on.
 *
 * Content writes only *mark* a project as behind (see `markSearchDirty`) —
 * reindexing on every save would charge for a sentence being typed, because
 * the novel editor autosaves every 2.5 seconds and embeddings are billed per
 * token. This is where the marking is actually acted on.
 *
 * Same two callers as the AI worker, for the same reason: Hobby cron fires
 * once a day, which is too slow to be the only trigger.
 */
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

function unauthorized(message: string, status: number): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: status === 503 ? 'not_configured' : 'unauthorized',
        message,
        requestId: newRequestId(),
      },
    },
    { status }
  )
}

async function authorize(request: Request): Promise<NextResponse | null> {
  const header = request.headers.get('authorization') ?? ''

  if (header.startsWith('Bearer ')) {
    const secret = process.env.CRON_SECRET
    if (!secret) {
      // Fail closed: without a configured secret the cron path stays shut.
      return unauthorized('CRON_SECRET 未設定，排程觸發已停用。見 docs/ENVIRONMENT.md', 503)
    }
    if (!safeEqual(header, `Bearer ${secret}`)) return unauthorized('cron 憑證不正確', 401)
    return null
  }

  if (!(await getSessionUser())) {
    return unauthorized('需要有效的 cron 憑證或登入工作階段', 401)
  }
  return null
}

export const POST = handle(async (request: Request) => {
  const denied = await authorize(request)
  if (denied) return denied

  /*
   * Three projects per invocation. Re-embedding a whole project can take
   * seconds, and the free Voyage tier allows three requests a minute — asking
   * for more than this inside a 60s budget would simply be throttled.
   */
  const requested = Number(new URL(request.url).searchParams.get('limit') ?? 3)
  const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 3, 1), 5)

  const reindexed = await reindexDirtyProjects(limit)

  /*
   * 順手把匯率抓回來 (Z150).
   *
   * 這裡本來不該管匯率。會放進來是因為 **Vercel Hobby 一個專案只有兩個
   * 排程**，而這個專案的兩個已經用掉了（AI worker 與這支）。匯率一天要更新
   * 一次，而這支就是那個每天跑一次的。
   *
   * 抓失敗不影響重建結果：匯率舊一天不會壞掉任何東西，而重建是這支的本業。
   * 升級方案之後，`vercel.json` 加一條指向 `/api/cron/fx` 就可以把這段拿掉。
   */
  let fx: Awaited<ReturnType<typeof refreshFxRates>> | { updated: false; reason: string }
  try {
    fx = await refreshFxRates(null)
  } catch (cause) {
    fx = { updated: false, reason: cause instanceof Error ? cause.message : '匯率更新失敗' }
  }

  return jsonOk({ ...reindexed, fx })
})

export const GET = POST
