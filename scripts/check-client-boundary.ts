import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * 用戶端元件不可以把伺服器端的東西拖進瀏覽器 (Z162).
 *
 * 這個錯誤**今天咬了我三次**，每一次都一樣：
 *
 *  - `storyboard.ts` → 拆成 `storyboard-view.ts`
 *  - `digest.ts` → 拆成 `digest-server.ts`
 *  - `episode-batch.ts` → 拆成 `episode-batch-view.ts`
 *
 * 形狀都是：一支 lib 裡放了純函式**和** `@/db`／`@/lib/api` 的查詢，然後一
 * 個 `'use client'` 元件為了那個純函式 import 它，於是整包伺服器端程式被拉
 * 進用戶端 bundle。
 *
 * ## 為什麼需要這支工具
 *
 * `tsc --noEmit` 是綠的。`npm run check` 是綠的。**只有 `next build` 會抓
 * 到**，而那要九十秒，所以通常是在準備提交的時候才發現——也就是最晚的那個
 * 時候。這支在兩秒內給同一個答案。
 *
 * ## 判準
 *
 * 從每一個 `'use client'` 檔案出發，沿著 `@/` 的 import 往下走，看會不會走
 * 到 `@/db`、`@/lib/api`、`next/headers` 或 `server-only`。走得到就是錯的，
 * 而且**把整條路徑印出來**——「哪一個 import 害的」才是要修的東西。
 *
 * 只追 `@/` 開頭的：`react`、`lucide-react` 那些不會拉伺服器端程式進來，而
 * 追進 node_modules 會讓這支工具從兩秒變成兩分鐘。
 */

const SRC = 'src'

/** 走到這些就代表這條路只能在伺服器端跑。 */
const SERVER_ONLY = ['@/db', 'next/headers', 'server-only']

/**
 * 這幾支自己就是伺服器端的入口。
 *
 * `@/lib/api` 要 `next/headers`（session 與 CSRF），`@/lib/settings` 要 `@/db`。
 * 列出來是為了讓錯誤訊息直接指出是哪一支，而不是印一條走到 `@/db` 的長路徑。
 */
const SERVER_MODULES = ['@/lib/api', '@/lib/auth/session', '@/lib/auth/csrf']

type FileText = { path: string; text: string }

function walk(dir: string, out: FileText[] = []): FileText[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }

  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      walk(full, out)
      continue
    }
    if (!/\.tsx?$/.test(entry)) continue
    out.push({
      path: relative(process.cwd(), full).split(sep).join('/'),
      text: readFileSync(full, 'utf8'),
    })
  }

  return out
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
}

/** 一個檔案 import 了哪些模組指名。 */
function importsOf(text: string): string[] {
  const body = stripComments(text)
  const out = new Set<string>()

  /*
   * 只算**會進 bundle** 的那些。
   *
   * `import type { X } from '@/lib/health'` 在編譯時就被抹掉了，一個位元組
   * 都不會進瀏覽器。第一版沒分辨，於是它對著七個完全正常的檔案報錯——而那
   * 七個的 `next build` 是綠的。一個會對正常程式碼報錯的檢查，第二天就會被
   * 當成雜訊關掉，那比沒有這支工具更糟。
   *
   * 混用的情況（`import { type A, B }`）照算：`B` 是值，它真的會進去。
   */
  const statik = /(?:^|\n)[ \t]*(import|export)[ \t]+([\s\S]*?)[ \t]from[ \t]+['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = statik.exec(body))) {
    const clause = (match[2] ?? '').trim()
    const spec = match[3]
    if (!spec) continue
    // `import type …` / `export type …`：整句都是型別。
    if (/^type\b/.test(clause)) continue
    out.add(spec)
  }

  const dynamic = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((match = dynamic.exec(body))) {
    if (match[1]) out.add(match[1])
  }

  return [...out]
}

/** `@/lib/x` → 實際的檔案路徑。 */
function resolve(spec: string, files: Map<string, FileText>): FileText | null {
  if (!spec.startsWith('@/')) return null
  const base = `src/${spec.slice(2)}`

  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    const file = files.get(candidate)
    if (file) return file
  }
  return null
}

function main() {
  const all = walk(SRC)
  const byPath = new Map(all.map((file) => [file.path, file]))

  /** 這個模組會不會走到伺服器端；回傳走到的路徑。 */
  const cache = new Map<string, string[] | null>()

  function serverPathFrom(file: FileText, seen: Set<string>): string[] | null {
    const cached = cache.get(file.path)
    if (cached !== undefined) return cached
    if (seen.has(file.path)) return null
    seen.add(file.path)

    for (const spec of importsOf(file.text)) {
      if (SERVER_ONLY.includes(spec) || SERVER_MODULES.includes(spec)) {
        const hit = [file.path, spec]
        cache.set(file.path, hit)
        return hit
      }

      const next = resolve(spec, byPath)
      if (!next) continue
      // 用戶端元件不會把伺服器端拉進來——它自己也是用戶端。
      if (next.text.includes("'use client'")) continue

      const deeper = serverPathFrom(next, seen)
      if (deeper) {
        const hit = [file.path, ...deeper]
        cache.set(file.path, hit)
        return hit
      }
    }

    cache.set(file.path, null)
    return null
  }

  const clients = all.filter((file) => stripComments(file.text).includes("'use client'"))
  const bad: string[][] = []

  for (const client of clients) {
    for (const spec of importsOf(client.text)) {
      if (SERVER_ONLY.includes(spec) || SERVER_MODULES.includes(spec)) {
        bad.push([client.path, spec])
        continue
      }
      const target = resolve(spec, byPath)
      if (!target || target.text.includes("'use client'")) continue

      const path = serverPathFrom(target, new Set())
      if (path) bad.push([client.path, ...path])
    }
  }

  /*
   * 自我檢查，正反各一。抓不到已知的壞例子就說工具壞了，不報平安——一個永遠
   * 說 OK 的檢查比沒有檢查更糟。
   */
  const problems: string[] = []
  if (clients.length === 0) problems.push('一個 use client 檔案都沒掃到')
  if (importsOf("import { a } from '@/db'").length !== 1) {
    problems.push('import 解析壞了')
  }
  // 反面：型別匯入不可以被算進來，不然七個正常的檔案會被報成錯。
  if (importsOf("import type { A } from '@/db'").length !== 0) {
    problems.push('型別匯入被當成會進 bundle')
  }
  // 但混用的要算：`B` 是值，它真的會進去。
  if (importsOf("import { type A, B } from '@/db'").length !== 1) {
    problems.push('混用型別與值的 import 被整句略過了')
  }
  if (resolve('@/lib/api', byPath)?.path !== 'src/lib/api.ts') {
    problems.push('模組路徑解析壞了')
  }

  if (problems.length > 0) {
    for (const problem of problems) console.log(`  ✗ 這支工具壞了：${problem}`)
    process.exitCode = 1
    return
  }

  console.log(`  掃 ${clients.length} 個用戶端元件（自我檢查通過）`)

  if (bad.length === 0) {
    console.log('  ✓ 沒有用戶端元件把伺服器端的東西拉進來')
    return
  }

  console.log(`\n  ✗ ${bad.length} 條路徑會把伺服器端程式拖進瀏覽器 bundle：\n`)
  for (const chain of bad) {
    console.log(`      ${chain.join('\n        → ')}`)
    console.log('')
  }
  console.log('  把那支 lib 的純函式拆成 `*-view.ts`，查資料的留在原處。')
  process.exitCode = 1
}

main()
