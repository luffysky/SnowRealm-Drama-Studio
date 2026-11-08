import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * 把程式碼裡每一個內部連結，拿去比對真正存在的路由 (Z139).
 *
 * 寫這支是因為 404 已經出現三次了，而且每次都是使用者踩到才知道：
 * 浮動播放器連 `/listen/<作品>`、AI 收件匣連 `/projects/.../episodes/<集數>`、
 * 總覽的分類卡片當年不敢做成連結。這類錯誤**不會**被 TypeScript 或測試攔下
 * 來——連結是字串，而字串永遠編得過。
 *
 * 做法是純靜態的：
 *
 *  1. 走 `src/app`，把每一個 `page.tsx` 變成一個路由樣板。路由群組
 *     （`(studio)`）不出現在網址裡，動態段（`[id]`）當成萬用字元。
 *  2. 掃原始碼裡的 `href="..."`、`href={\`...\`}`、`router.push(...)`。
 *     樣板字串裡的 `${...}` 一樣當成萬用字元。
 *  3. 兩邊比對，列出對不上的。
 *
 * 它看不到完全在執行期才拼出來的網址（例如從資料庫欄位來的整條路徑），
 * 那種只有真的點下去才知道——所以這支是防線，不是保證。
 */

const APP = join('src', 'app')

/* -------------------------------------------------------------------------- */
/* 真正存在的路由                                                              */
/* -------------------------------------------------------------------------- */

function routesUnder(dir: string, prefix: string[] = []): string[] {
  const out: string[] = []

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (!statSync(full).isDirectory()) {
      // A folder holding page.tsx is a real page; route.ts is an API, not a link.
      if (entry === 'page.tsx' || entry === 'page.ts') {
        out.push('/' + prefix.join('/'))
      }
      continue
    }

    // Route groups and private folders never appear in the URL.
    if (entry.startsWith('(') && entry.endsWith(')')) {
      out.push(...routesUnder(full, prefix))
      continue
    }
    if (entry.startsWith('_') || entry === 'api') continue

    out.push(...routesUnder(full, [...prefix, entry]))
  }

  return out
}

/** `/projects/[projectId]/novel` → `/projects/*\/novel` */
function patternOf(route: string): string {
  return route
    .split('/')
    .map((segment) => (segment.startsWith('[') ? '*' : segment))
    .join('/')
}

/* -------------------------------------------------------------------------- */
/* 程式碼裡的連結                                                              */
/* -------------------------------------------------------------------------- */

type Found = { file: string; line: number; raw: string; path: string }

/** `/read/${id}/text?x=1` → `/read/*\/text` */
function normalise(raw: string): string | null {
  let path = raw.trim()

  // Not an internal path.
  if (!path.startsWith('/')) return null
  if (path.startsWith('//')) return null

  // Drop the query and hash — routing does not see them.
  path = path.split('?')[0]!.split('#')[0]!

  // Template holes and obvious interpolation become a wildcard segment.
  path = path.replace(/\$\{[^}]*\}/g, '*')

  // `/a/*b` (interpolation glued to text) is still one segment.
  path = path
    .split('/')
    .map((segment) => (segment.includes('*') ? '*' : segment))
    .join('/')

  // Trailing slash is the same route.
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)

  return path
}

function scan(dir: string, out: Found[] = []): Found[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)

    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      scan(full, out)
      continue
    }

    if (!/\.(tsx?|mjs)$/.test(entry)) continue

    const text = readFileSync(full, 'utf8')
    text.split('\n').forEach((line, index) => {
      // href="/x" | href={`/x/${y}`} | href={'/x'} | router.push(`/x`)
      /*
       * 第四條是**物件屬性**那個形狀：`href: '/x'`、`href: to('/x')`。
       *
       * 儀表板的「內容存量」把一排 `{ label, value, href }` 算成陣列再
       * `href={row.href}` 展開，於是路徑字面值離 `href=` 有好幾行遠——前三條
       * 全部看不到它，而那條連結指向 `/projects/<id>/script`（磁碟上是
       * `scripts`，複數）。這支工具當時是綠的。
       *
       * 抓的是「這一行有 `href:`」然後把這一行所有看起來像路由的字面值撈出
       * 來——包不包在函式呼叫裡都一樣撈得到。
       */
      const patterns = [
        /href=["'](\/[^"']*)["']/g,
        /href=\{[`'"](\/[^`'"]*)[`'"]\}/g,
        /(?:router\.(?:push|replace)|redirect)\(\s*[`'"](\/[^`'"]*)[`'"]/g,
        ...(/\bhref:\s/.test(line) ? [/[`'"](\/[^`'"\s]*)[`'"]/g] : []),
      ]

      for (const pattern of patterns) {
        for (const match of line.matchAll(pattern)) {
          const path = normalise(match[1]!)
          if (!path) continue
          out.push({
            file: relative(process.cwd(), full).split(sep).join('/'),
            line: index + 1,
            raw: match[1]!,
            path,
          })
        }
      }
    })
  }

  return out
}

/* -------------------------------------------------------------------------- */

function matches(link: string, route: string): boolean {
  const a = link.split('/')
  const b = route.split('/')
  if (a.length !== b.length) return false

  return a.every((segment, index) => {
    const other = b[index]!
    return segment === '*' || other === '*' || segment === other
  })
}

/**
 * 先確認這支工具抓得到東西 (Z139).
 *
 * 一個永遠回報「沒問題」的檢查，比沒有檢查更糟——它會讓人停止自己看。所以
 * 每次執行都先拿兩個**真的出現過**的壞連結試一次：如果連它們都抓不到，就
 * 直接說這支工具壞了，不要報平安。
 *
 * 這兩個不是假想的例子：浮動播放器連過 `/listen/<作品>`，而
 * `/watch/<作品>/<集數>` 是影片播放頁連過的——兩個都是使用者踩到才發現的。
 *
 * **`/projects/*\/episodes/*` 以前在這份清單裡，2026-11-05 拿掉了**：Z36 把
 * 集數詳情頁做出來，那條路由真的存在了，所以它不再是壞連結。這支工具當場
 * 報「我壞了」而不是報平安——那正是它該做的事，但也表示這種自我檢查必須跟
 * 著路由一起維護。
 */
function selfTest(routes: string[]): boolean {
  /*
   * 掃描器自己也要測一次 (Z194).
   *
   * 路由清單對不對是一回事，**掃描器看不看得見某一種寫法**是另一回事——而後
   * 者才是 `/script` 那個 404 溜過去的原因。這一段餵它一行物件屬性形狀的
   * 連結，抓不到就直接說工具壞了。
   */
  const sample = "      href: to('/zzz-not-a-route'),"
  const seen: string[] = []
  if (/\bhref:\s/.test(sample)) {
    for (const match of sample.matchAll(/[`'"](\/[^`'"\s]*)[`'"]/g)) seen.push(match[1]!)
  }
  if (!seen.includes('/zzz-not-a-route')) {
    console.log('  ✗ 這支工具壞了：`href: to(\'/x\')` 這種寫法掃不到')
    return false
  }

  const shouldFail = ['/listen/*', '/watch/*/*']
  const shouldPass = ['/listen', '/projects/*/episodes', '/projects/*/episodes/*']

  const missed = shouldFail.filter((path) => routes.some((route) => matches(path, route)))
  const falseAlarm = shouldPass.filter((path) => !routes.some((route) => matches(path, route)))

  if (missed.length > 0) {
    console.log(`  ✗ 這支工具壞了：${missed.join('、')} 應該被抓出來卻通過了`)
  }
  if (falseAlarm.length > 0) {
    console.log(`  ✗ 這支工具壞了：${falseAlarm.join('、')} 是好的卻被誤報`)
  }

  return missed.length === 0 && falseAlarm.length === 0
}

function main() {
  const routes = [...new Set(routesUnder(APP).map(patternOf))].sort()
  const links = scan('src')

  if (!selfTest(routes)) {
    process.exitCode = 1
    return
  }

  console.log(`  路由 ${routes.length} 條，連結 ${links.length} 處（自我檢查通過）`)

  const broken = links.filter((link) => !routes.some((route) => matches(link.path, route)))

  if (broken.length === 0) {
    console.log('  ✓ 每一個連結都對得到路由')
    return
  }

  /** Grouped, because the same bad link is usually written in several places. */
  const byPath = new Map<string, Found[]>()
  for (const link of broken) {
    const list = byPath.get(link.path) ?? []
    list.push(link)
    byPath.set(link.path, list)
  }

  console.log(`  ✗ ${byPath.size} 種連結對不到路由：`)
  for (const [path, found] of [...byPath.entries()].sort()) {
    console.log(`\n  ${path}   （${found.length} 處）`)
    for (const row of found.slice(0, 4)) {
      console.log(`      ${row.file}:${row.line}  ${row.raw}`)
    }
    if (found.length > 4) console.log(`      …還有 ${found.length - 4} 處`)
  }

  console.log('\n  現有的路由：')
  for (const route of routes) console.log(`      ${route}`)

  process.exitCode = 1
}

main()
