import { NextResponse } from 'next/server'
import { handle, jsonOk, newRequestId } from '@/lib/api'
import { getSessionUser } from '@/lib/auth/session'
import { safeEqual } from '@/lib/crypto'
import { refreshFxRates } from '@/lib/fx-fetch'
import { getFxRates } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 每天把匯率抓回來 (Z150).
 *
 * 「匯率是動態的每天都在變，想辦法每天取得」。
 *
 * 兩個觸發口，跟 AI worker 與搜尋重建同一套：排程用 `CRON_SECRET`，人用
 * 自己的工作階段（系統設定裡那顆「立刻更新」）。Hobby 方案的 cron 一天只
 * 跑一次，所以手動那條不是多餘的——改了幣別想立刻看到正確數字的時候要用。
 *
 * **抓壞了就不寫。** 匯率錯了比匯率舊了糟糕得多：舊的至少還是一個真的
 * 匯率，錯的會讓每一筆錢都錯而且看起來正常。驗證在 `fx-fetch.ts`。
 */

function unauthorized(message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: { code: status === 503 ? 'not_configured' : 'unauthorized', message, requestId: newRequestId() } },
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

  const user = await getSessionUser()
  if (!user) return unauthorized('需要有效的 cron 憑證或登入工作階段', 401)
  return null
}

export const POST = handle(async (request: Request) => {
  const denied = await authorize(request)
  if (denied) return denied

  /*
   * 排程沒有使用者。`writeSetting` 記的是「誰改的」，而排程改的就是排程改
   * 的——硬塞一個人進去會讓稽核紀錄說謊。
   */
  const user = await getSessionUser()
  const result = await refreshFxRates(user?.id ?? null)

  /*
   * 一律 200，連「今天沒抓到」也是。
   *
   * 排程抓不到匯率不是系統故障，而把它報成故障會讓真正的故障淹沒在雜訊裡。
   * 原因照實回傳，呼叫端自己判斷。
   */
  const current = await getFxRates()

  return jsonOk({
    ...result,
    current: { base: current.base, asOf: current.asOf, source: current.source },
  })
})

/*
 * 刻意沒有 `export const GET = POST`。
 *
 * 本來有——照其他 cron 路由的樣子寫的。但每天那一次最後是由搜尋重建那支
 * 順手跑的（Hobby 只有兩個排程名額），所以沒有任何東西會 GET 這條路徑，
 * 而 `npm run check:api` 立刻把它抓出來了。
 *
 * 之後升級方案、在 `vercel.json` 加一條指向這裡的排程時再加回來：Vercel 的
 * cron 是用 GET 打的。
 */
