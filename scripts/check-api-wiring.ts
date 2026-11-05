import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * 每一支後端 API，介面上有沒有地方叫得到它 (Z146).
 *
 * 「所有後端 API 都要有前端介面可以調用，不然做來幹嘛」。
 *
 * 這不是假設性的問題。一個晚上就抓到三個：`deleteAsset` 寫好了沒人呼叫、
 * `characters.voiceStyle` 存得進去但沒有任何產生音訊的程式讀它、
 * `characters.voiceId` 閱讀器讀而有聲書沒查出來。**這一類不會報錯**——
 * 編得過、測試過、介面上的設定看起來有效，就是不會發生任何事。
 *
 * TypeScript 攔不住：路由是檔案系統決定的，呼叫是字串。兩邊永遠編得過。
 *
 * ## 做法
 *
 *  1. 走 `src/app/api`，每個 `route.ts` 變成一個網址樣板加上它匯出的方法。
 *  2. 掃 `src` 其餘地方（**不含 api 自己**）出現過的網址字串。
 *     不只看 `fetch`——`/api/files/<id>` 是放進 `<img src>` 的，從來不被
 *     fetch 呼叫，但它當然有在用。
 *  3. 兩邊對。對不到的分兩級：**整支沒人叫**，以及**某個方法沒人用**
 *     （例如 DELETE 匯出了但介面上沒有刪除鈕——那正是 Z138 那個 bug）。
 *
 * ## 它不會抓到什麼
 *
 * 動態拼出來的網址（`/api/${kind}/${id}`）只能退化成萬用字元比對，所以
 * 可能把沒人用的判成有人用。寧可漏報也不要誤報：一份充滿假警報的清單，
 * 跟沒有清單一樣會被忽略。
 */

const API = join('src', 'app', 'api')

/**
 * 註解裡的程式碼不是程式碼。
 *
 * 這支工具自己踩到了：一支路由的註解裡寫著「刻意沒有 `export const GET =
 * POST`」來說明為什麼拿掉，而偵測處理函式的比對照樣把它算成一個真的 GET
 * ——於是它回報「GET 沒有人呼叫」，而那個 GET 根本不存在。
 *
 * 一個把註解當程式碼的掃描器，會逼人為了安撫工具而改寫註解，那是本末倒置。
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/gm, '$1')
}
const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const
type Method = (typeof METHODS)[number]

/* -------------------------------------------------------------------------- */
/* 有哪些路由                                                                  */
/* -------------------------------------------------------------------------- */

type Route = {
  /** `/api/projects/*\/characters/*` */
  pattern: string
  file: string
  methods: Method[]
}

function routesUnder(dir: string, prefix: string[]): Route[] {
  const out: Route[] = []

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)

    if (statSync(full).isDirectory()) {
      // 路由群組不出現在網址裡。
      if (entry.startsWith('(') && entry.endsWith(')')) {
        out.push(...routesUnder(full, prefix))
        continue
      }
      if (entry.startsWith('_')) continue
      out.push(...routesUnder(full, [...prefix, entry]))
      continue
    }

    if (entry !== 'route.ts' && entry !== 'route.tsx') continue

    const text = stripComments(readFileSync(full, 'utf8'))
    const methods = METHODS.filter((method) =>
      new RegExp(`export\\s+(const|async\\s+function|function)\\s+${method}\\b`).test(text)
    )

    out.push({
      pattern:
        '/' +
        prefix.map((segment) => (segment.startsWith('[') ? '*' : segment)).join('/'),
      file: relative(process.cwd(), full).split(sep).join('/'),
      methods,
    })
  }

  return out
}

/* -------------------------------------------------------------------------- */
/* 誰叫了它                                                                    */
/* -------------------------------------------------------------------------- */

type Reference = { file: string; line: number; path: string; methods: Set<Method> }

/** `/api/read/${id}/text?x=1` → `/api/read/*\/text` */
function normalise(raw: string): string | null {
  let path = raw.trim()
  if (!path.startsWith('/api/')) return null

  /*
   * 先把插值換成萬用字元，**再**切查詢字串。
   *
   * 順序反了會出事：`?${params.toString()}` 裡那個 `?` 是查詢字串的開頭沒錯，
   * 但 `${...}` 裡面也可能有 `?`（`${extra ?? ''}`）。而且插值可以換行——
   * 這兩件事讓第一版漏掉了 `/novel/export`，然後把一支天天在用的路由報成
   * 沒人用。
   */
  path = path.replace(/\$\{[\s\S]*?\}/g, '*')
  path = path.split('?')[0]!.split('#')[0]!
  // 插值換掉之後還有空白，表示這個字串不是單純的網址，取到空白為止。
  path = path.split(/\s/)[0]!
  path = path
    .split('/')
    .map((segment) => (segment.includes('*') ? '*' : segment))
    .join('/')
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)

  return path
}

/** `put(...)` → PUT。輔助函式常常就叫那個動詞的名字。 */
const HELPER_VERB: Record<string, Method> = {
  get: 'GET',
  post: 'POST',
  patch: 'PATCH',
  put: 'PUT',
  del: 'DELETE',
  remove: 'DELETE',
  destroy: 'DELETE',
}

/**
 * 這個呼叫用的是什麼方法。
 *
 * 第一版只找 `method: 'X'`，結果**兩個都誤判**：
 *
 *     put('/api/settings/fx', draft, '匯率')          方法在輔助函式裡
 *     method: mode === 'create' ? 'POST' : 'PATCH'   方法由三元運算決定
 *
 * 兩個都是真的有在用，卻被判成沒人用。所以這裡改成**寧可多算**：窗口裡
 * 出現的任何方法字面值都算，再加上輔助函式的名字。
 *
 * 多算的代價是漏報一支真的沒人用的路由；少算的代價是整份清單充滿假警報，
 * 然後被忽略。**這兩個代價不對稱。**
 */
function methodsNear(lines: string[], at: number, line: string): Set<Method> {
  const window = lines.slice(Math.max(0, at - 2), at + 14).join('\n')
  const found = new Set<Method>()

  // `method:` 明寫的，以及三元運算裡的裸字面值。
  for (const match of window.matchAll(/['"`](GET|POST|PATCH|PUT|DELETE)['"`]/g)) {
    found.add(match[1] as Method)
  }

  // `put('/api/…')`、`del(`/api/…`)` 這種以動詞命名的輔助函式。
  const helper = /\b([a-zA-Z]+)\s*\(\s*['"`]\/api\//.exec(line)
  const verb = helper ? HELPER_VERB[helper[1]!.toLowerCase()] : undefined
  if (verb) found.add(verb)

  // 沒有寫方法就是 GET，那是 fetch 的預設。
  if (found.size === 0) found.add('GET')
  return found
}

function scan(dir: string, out: Reference[] = []): Reference[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)

    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      // 不掃 api 自己：一支路由在自己的檔案裡提到自己不算有人用。
      if (full.split(sep).join('/').endsWith('src/app/api')) continue
      scan(full, out)
      continue
    }

    if (!/\.(tsx?|mjs)$/.test(entry)) continue

    const text = readFileSync(full, 'utf8')
    const lines = text.split(/\r?\n/)

    /*
     * 整份檔案一起掃，不是一行一行。
     *
     * 樣板字串可以跨行，而一行一行掃就看不到結尾的反引號，於是比對失敗——
     * 失敗的方式是「沒找到」，所以那支路由會被報成沒人用。第一版就是這樣
     * 冤枉了 `/novel/export`，一支天天在用的匯出端點。
     *
     * 非貪婪，所以會停在最近的那個引號，不會跨到不相干的字串去。
     */
    for (const match of text.matchAll(/['"`](\/api\/[\s\S]{0,300}?)['"`]/g)) {
      const path = normalise(match[1]!)
      if (!path) continue

      const index = text.slice(0, match.index).split(/\r?\n/).length - 1
      out.push({
        file: relative(process.cwd(), full).split(sep).join('/'),
        line: index + 1,
        path,
        methods: methodsNear(lines, index, lines[index] ?? ''),
      })
    }
  }

  return out
}

/* -------------------------------------------------------------------------- */

function matches(reference: string, route: string): boolean {
  const a = reference.split('/')
  const b = route.split('/')
  if (a.length !== b.length) return false
  return a.every((segment, index) => {
    const other = b[index]!
    return segment === '*' || other === '*' || segment === other
  })
}

/**
 * 先確認這支工具抓得到東西。
 *
 * 一個永遠回報「全部有接」的檢查，比沒有檢查更糟——它會讓人停止自己看。
 * 所以每次執行先試兩件**已知為真**的事：一支確定有介面在用的路由必須判成
 * 有人用，一個不存在的路徑必須判成沒人用。
 */
function selfTest(routes: Route[], references: Reference[]): boolean {
  const used = (path: string) =>
    references.some((reference) => matches(reference.path, path))

  const problems: string[] = []

  const usedWith = (path: string, method: Method) =>
    references.some(
      (reference) => matches(reference.path, path) && reference.methods.has(method)
    )

  // VoicePicker 真的在呼叫它（Z140）。
  if (!used('/api/speech/voices')) {
    problems.push('/api/speech/voices 明明有人用，卻判成沒人用')
  }
  // 不存在的路徑絕對不該有人用。
  if (used('/api/definitely-not-a-real-route')) {
    problems.push('不存在的路徑被判成有人用')
  }

  /*
   * 下面三條是這支工具**自己出過的錯**，不是假想的例子。
   *
   * 第一版把三支天天在用的路由報成沒人用，原因全是它自己的比對寫壞了：
   *
   *   put('/api/settings/fx', …)                  方法在輔助函式裡
   *   method: mode === 'create' ? 'POST' : …      方法由三元運算決定
   *   `/api/…/export?${params.toString()}…`       樣板字串跨行又含空白
   *
   * 一份充滿假警報的清單，跟沒有清單一樣會被忽略——而且更糟，因為它會讓人
   * 以為自己檢查過了。所以這三條永久留著。
   */
  if (!usedWith('/api/settings/fx', 'PUT')) {
    problems.push('SystemSettings 的 put() 輔助函式認不出來')
  }
  if (!usedWith('/api/projects/*/assets/music', 'POST')) {
    problems.push('MusicForm 用三元運算決定的方法認不出來')
  }
  if (!used('/api/projects/*/novel/export')) {
    problems.push('跨行的樣板字串網址認不出來')
  }
  if (routes.length < 10) {
    problems.push(`只找到 ${routes.length} 條路由，掃描壞了`)
  }
  if (references.length < 10) {
    problems.push(`只找到 ${references.length} 處呼叫，掃描壞了`)
  }

  for (const problem of problems) console.log(`  ✗ 這支工具壞了：${problem}`)
  return problems.length === 0
}

/**
 * 不需要前端呼叫的路由，以及為什麼。
 *
 * **每一條都要寫理由。** 一個沒有理由的豁免清單，過一陣子就變成「反正它
 * 一直在清單上」，而那正是這支工具要防的東西。
 *
 * 排程那幾條**從 `vercel.json` 讀出來**，不是手寫的。手寫的版本第一次跑就
 * 漏了 `/api/search/reindex`——它確實沒有任何介面呼叫，因為它是每天 03:30
 * 由 cron 打的。差一點就把一個排程工作當成死碼刪掉。
 *
 * 讀設定檔的好處是它**不會過期**：加一條 cron 就自動豁免，移掉一條就自動
 * 重新被檢查。
 */
function cronExemptions(): { pattern: string; why: string }[] {
  try {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      crons?: { path?: string; schedule?: string }[]
    }
    return (config.crons ?? [])
      .map((row) => (row.path ?? '').split('?')[0]!)
      .filter(Boolean)
      .map((path) => ({ pattern: path, why: 'vercel.json 裡的排程' }))
  } catch {
    // 沒有設定檔就沒有排程豁免。寧可多報，不要靜悄悄地放過。
    return []
  }
}

/**
 * 豁免可以只針對一個方法。
 *
 * `/api/ai/jobs` 的 POST 介面天天在用，GET 只有冒煙測試在打——整支豁免會
 * 把 POST 也一起放過，而那支要是哪天沒人叫了，就沒有人會發現。
 */
const EXEMPT: { pattern: string; method?: Method; why: string }[] = [
  ...cronExemptions(),
  { pattern: '/api/auth/callback', why: 'OAuth 轉回來的落點' },
  { pattern: '/api/health', why: '監控用' },
  /*
   * 冒煙測試在用的。不是介面，但也不是沒人用——`scripts/smoke.ts` 拿它們
   * 驗證登入狀態與權限，而那是一個真的消費者。
   */
  { pattern: '/api/auth/me', why: 'scripts/smoke.ts 用它驗證登入狀態' },
  { pattern: '/api/auth/sessions', why: 'scripts/smoke.ts 用它驗證登入裝置' },
  {
    pattern: '/api/ai/jobs',
    method: 'GET',
    why: 'scripts/smoke.ts 用它驗證匿名會被擋；介面是用 router.refresh() 重繪整頁',
  },
]

/** 整支豁免（沒有指定方法的那種）。 */
function exemptFor(pattern: string): string | null {
  return EXEMPT.find((row) => !row.method && matches(pattern, row.pattern))?.why ?? null
}

/** 只豁免某一個方法。 */
function exemptMethod(pattern: string, method: Method): string | null {
  return (
    EXEMPT.find((row) => row.method === method && matches(pattern, row.pattern))?.why ?? null
  )
}

function main() {
  const routes = routesUnder(API, ['api']).sort((a, b) => a.pattern.localeCompare(b.pattern))
  const references = scan('src')

  if (!selfTest(routes, references)) {
    process.exitCode = 1
    return
  }

  const handlers = routes.reduce((total, route) => total + route.methods.length, 0)
  console.log(`  ${routes.length} 支路由、${handlers} 個處理函式，${references.length} 處呼叫（自我檢查通過）\n`)

  /** 整支沒人叫。 */
  const orphanRoutes: Route[] = []
  /** 有人叫，但某個方法沒人用。 */
  const orphanMethods: { route: Route; method: Method }[] = []

  for (const route of routes) {
    if (exemptFor(route.pattern)) continue

    const callers = references.filter((reference) => matches(reference.path, route.pattern))

    if (callers.length === 0) {
      orphanRoutes.push(route)
      continue
    }

    const used = new Set<Method>()
    for (const caller of callers) for (const method of caller.methods) used.add(method)

    for (const method of route.methods) {
      if (used.has(method)) continue
      if (exemptMethod(route.pattern, method)) continue
      orphanMethods.push({ route, method })
    }
  }

  if (orphanRoutes.length === 0 && orphanMethods.length === 0) {
    console.log('  ✓ 每一支 API 介面上都叫得到')
    return
  }

  if (orphanRoutes.length > 0) {
    console.log(`  ✗ ${orphanRoutes.length} 支路由前端完全沒有呼叫：\n`)
    for (const route of orphanRoutes) {
      console.log(`      ${route.pattern}   [${route.methods.join(' ')}]`)
      console.log(`          ${route.file}`)
    }
    console.log()
  }

  if (orphanMethods.length > 0) {
    console.log(`  ✗ ${orphanMethods.length} 個處理函式沒有任何呼叫端使用：\n`)
    for (const { route, method } of orphanMethods) {
      console.log(`      ${method.padEnd(6)} ${route.pattern}`)
      console.log(`          ${route.file}`)
    }
    console.log()
  }

  console.log('  豁免清單（都有寫理由）：')
  for (const row of EXEMPT) console.log(`      ${row.pattern}  ——  ${row.why}`)

  process.exitCode = 1
}

main()
