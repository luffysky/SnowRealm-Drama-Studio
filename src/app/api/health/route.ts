import { NextResponse } from 'next/server'
import { handle, jsonOk, newRequestId } from '@/lib/api'
import { getSessionUser } from '@/lib/auth/session'
import { safeEqual } from '@/lib/crypto'
import { healthReport } from '@/lib/health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 執行期健康狀態 (Z161).
 *
 * 兩個觸發口，跟 AI worker、搜尋重建、匯率那三支同一套：排程用
 * `CRON_SECRET`，人用自己的工作階段（系統設定裡那顆「立刻檢查」）。
 *
 * ## 為什麼要有這支，而不是只有本機腳本
 *
 * 每日排程跑在雲端，而雲端拿不到 `.env.local` 裡的 Neon 連線字串。要讓它看
 * 得到狀態，只有兩條路：把整個資料庫的連線字串送上雲，或是開一支受保護的
 * 唯讀端點讓它打。
 *
 * 選後者，因為**秘密的大小差很多**：連線字串等於整個資料庫的讀寫權，而這支
 * 的 bearer token 就算外洩，別人最多看到「你有幾個失敗任務、這個月花了多少」。
 *
 * ## 只讀不寫
 *
 * 它不重試任何任務、不解任何鎖、不改任何設定。一支會在半夜自己動手的健康
 * 檢查，比沒有健康檢查危險。
 */

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
    /*
     * 自己一把 token，**不要共用 `CRON_SECRET`** (Z161).
     *
     * `CRON_SECRET` 同時開著 `/api/ai/worker`、`/api/search/reindex` 與
     * `/api/cron/fx` 三道門，而第一道**會花錢**（它會把佇列裡的任務跑掉）。
     * 把它交給一個跑在別人機器上的每日排程，等於把「可以動用你的 API 額度」
     * 一起交出去。
     *
     * 這一把只開這一道唯讀的門。外洩的代價是別人看得到你有幾個失敗任務。
     */
    const secret = process.env.HEALTH_TOKEN
    // Fail closed：沒設 token 就不開這條路，不要退回成「誰都能打」。
    if (!secret) {
      return unauthorized('HEALTH_TOKEN 未設定，排程觸發已停用。見 docs/ENVIRONMENT.md', 503)
    }
    if (!safeEqual(header, `Bearer ${secret}`)) return unauthorized('憑證不正確', 401)
    return null
  }

  const user = await getSessionUser()
  if (!user) return unauthorized('需要有效的憑證或登入工作階段', 401)
  return null
}

export const GET = handle(async (request: Request) => {
  const denied = await authorize(request)
  if (denied) return denied

  const report = await healthReport()

  /*
   * 一律 200，有問題也是。
   *
   * 「有三個失敗任務」是**回報的內容**，不是這支 API 失敗了。回 5xx 會讓監
   * 控把「系統正常回報了壞消息」跟「這支端點掛了」混成同一件事。
   */
  return jsonOk(report)
})
