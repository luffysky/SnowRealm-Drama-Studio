import { CURRENCIES, DEFAULT_FX, type CurrencyValue, type FxRates } from '@/lib/money'

/**
 * 每天把匯率抓回來 (Z150).
 *
 * 「匯率是動態的每天都在變，想辦法每天取得」。
 *
 * 在這之前匯率是手動填的，而手動填的後果已經看到了：資料庫裡存著
 * `base: 'CNY'` 配上 `{CNY: 0.22, TWD: 1, USD: 0.15}`——一張以台幣為基準的
 * 表貼上人民幣的標籤，於是 1 美金換成 1.47 人民幣（實際約 6.7）。成本中心
 * 照樣顯示、照樣加總，因為**每一個數字看起來都像錢**。
 *
 * ## 來源
 *
 * `open.er-api.com`（exchangerate-api.com 的免費端點）：不用金鑰、支援台幣。
 * 後面這點刪掉了大部分選項——ECB 系的 API（Frankfurter 那類）根本沒有 TWD。
 *
 * 回傳的形狀**剛好就是** `FxRates`：base 加上「1 單位 base 等於多少該幣別」。
 * 不用做語意轉換，而不用轉換的地方就不會轉錯。
 *
 * ## 絕不用垃圾蓋掉好資料
 *
 * 抓回來的東西要先過三關才寫進去：三種幣別齊全、基準對自己是 1、每個數字
 * 都在合理範圍內。任何一關過不了就**原封不動**——匯率錯了比匯率舊了糟糕
 * 得多，因為舊的至少還是一個真的匯率。
 */

/** 免費、不用金鑰、有台幣。 */
const ENDPOINT = 'https://open.er-api.com/v6/latest/TWD'

/** 抓不回來不該卡住排程。 */
const TIMEOUT_MS = 8_000

/**
 * 合理範圍：跟手填的基準值比，差到幾倍就當成垃圾。
 *
 * 這一關不是在追求精準，是在擋 `0`、`null`、`1e9` 這種東西。真實匯率一年
 * 動個幾個百分點，不會變成十倍——所以十倍寬到不可能誤殺，又窄到抓得住
 * 「這個回應根本不是匯率」。
 */
const SANITY_FACTOR = 10

export type FxFetchOutcome =
  | { ok: true; rates: FxRates; changed: boolean }
  | { ok: false; reason: string }

/**
 * 把供應商的回應變成 `FxRates`，順便擋掉不合理的。
 *
 * 純函式，所以「什麼樣的回應會被接受」這件事測得到。這很重要：驗證寫鬆了
 * 不會報錯，只會在某一天把一組壞匯率存進去，然後每一筆錢都錯。
 */
export function parseLiveRates(body: unknown, now = new Date()): FxFetchOutcome {
  if (!body || typeof body !== 'object') return { ok: false, reason: '回應不是物件' }

  const row = body as Record<string, unknown>

  if (row.result && row.result !== 'success') {
    return { ok: false, reason: `供應商回報失敗：${String(row.result)}` }
  }

  const base = String(row.base_code ?? '')
  if (!(CURRENCIES as readonly string[]).includes(base)) {
    return { ok: false, reason: `基準幣別 ${base || '（空的）'} 不在我們用的三種裡` }
  }

  const raw = row.rates
  if (!raw || typeof raw !== 'object') return { ok: false, reason: '回應裡沒有 rates' }

  const source = raw as Record<string, unknown>
  const rates = {} as Record<CurrencyValue, number>

  for (const code of CURRENCIES) {
    const value = source[code]
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return { ok: false, reason: `缺少或不合理的 ${code} 匯率` }
    }
    rates[code] = value
  }

  // 基準對自己只能是 1——這正是手填那版出錯的地方。
  if (Math.abs(rates[base as CurrencyValue] - 1) > 1e-9) {
    return { ok: false, reason: `基準 ${base} 對自己的匯率是 ${rates[base as CurrencyValue]}，不是 1` }
  }

  /*
   * 跟手填的基準值比一比。
   *
   * 兩邊的 base 都是台幣，所以可以直接比。base 不同的話就跳過這一關——
   * 與其用一個自己都算不準的換算去擋，不如承認這關檢查不適用。
   */
  if (base === DEFAULT_FX.base) {
    for (const code of CURRENCIES) {
      const expected = DEFAULT_FX.rates[code]
      if (!expected) continue
      const ratio = rates[code] / expected
      if (ratio > SANITY_FACTOR || ratio < 1 / SANITY_FACTOR) {
        return {
          ok: false,
          reason: `${code} 匯率 ${rates[code]} 跟基準值 ${expected} 差太多，當成壞資料`,
        }
      }
    }
  }

  const asOf =
    typeof row.time_last_update_utc === 'string' && row.time_last_update_utc
      ? new Date(row.time_last_update_utc).toISOString().slice(0, 10)
      : now.toISOString().slice(0, 10)

  return {
    ok: true,
    changed: false,
    rates: {
      base: base as CurrencyValue,
      rates,
      asOf,
      source: `open.er-api.com 自動更新`,
    },
  }
}

/** 抓一次。網路或供應商出問題時回 `ok: false`，不丟例外。 */
export async function fetchLiveRates(): Promise<FxFetchOutcome> {
  const control = new AbortController()
  const timer = setTimeout(() => control.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(ENDPOINT, {
      signal: control.signal,
      headers: { accept: 'application/json' },
      // 匯率一天才動一次，但我們自己決定什麼時候抓，不要拿到快取的。
      cache: 'no-store',
    })

    if (!response.ok) return { ok: false, reason: `供應商回 ${response.status}` }

    return parseLiveRates(await response.json())
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return { ok: false, reason: `抓不到匯率：${message}` }
  } finally {
    clearTimeout(timer)
  }
}

/** 兩組匯率實質上一樣嗎——一樣就不用寫，也不用記一筆動態。 */
export function sameRates(a: FxRates, b: FxRates): boolean {
  if (a.base !== b.base) return false
  return CURRENCIES.every((code) => Math.abs((a.rates[code] ?? 0) - (b.rates[code] ?? 0)) < 1e-9)
}

export type FxRefresh =
  | { updated: true; rates: FxRates; previousAsOf: string }
  | { updated: false; reason: string }

/**
 * 抓一次並存起來。
 *
 * 抽成函式而不是只有路由，因為它有兩個呼叫端，而且其中一個**不能走 HTTP**：
 * Vercel Hobby 方案一個專案只有兩個排程，而這個專案的兩個已經用掉了（AI
 * worker 與搜尋重建）。所以每天那一次是由既有的排程順手呼叫的，不是第三
 * 個 cron。
 *
 * 另一個呼叫端是系統設定裡的「立刻更新」——排程一天只跑一次，想馬上看到
 * 正確數字的時候要用。
 */
export async function refreshFxRates(userId: string | null): Promise<FxRefresh> {
  const { getFxRates, setFxRates } = await import('@/lib/settings')

  const fetched = await fetchLiveRates()
  if (!fetched.ok) return { updated: false, reason: fetched.reason }

  const current = await getFxRates()
  if (sameRates(current, fetched.rates) && current.asOf === fetched.rates.asOf) {
    return { updated: false, reason: '跟現有的一樣，沒有寫入' }
  }

  await setFxRates(fetched.rates, userId)
  return { updated: true, rates: fetched.rates, previousAsOf: current.asOf }
}
