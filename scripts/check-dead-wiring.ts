import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * 寫好了、沒有人用 (Z159).
 *
 * 這個專案一再出現同一個形狀的 bug，而且每一次都是人用眼睛發現的：
 *
 *  - `approvals.ts` 把定稿與鎖定寫得很完整，**每一支函式都沒有呼叫端**，
 *    而 `assertNotLocked` 的註解還寫著「Call this at the top of any write
 *    path」。
 *  - `TASK_EFFORT` 那張表做好了，被佇列的 `?? 'high'` 蓋掉，**一次都沒被讀
 *    到過**，而 Z22 在待辦上是打勾的。
 *  - `model_assignments` 那張表從第一支 migration 就在，零個呼叫端。
 *  - `characters.voiceStyle`、`episodes.targetSec`、`attributionStatus`⋯
 *
 * 共同點不是「沒做完」，是**沒有任何東西會告訴你它沒在運作**。型別檢查過、
 * 測試過、畫面也正常，因為那段程式根本沒有被執行到。
 *
 * 所以這支工具只回答一個問題：**有沒有人用它。**
 *
 * ## 判準只有一個，而且是單向的
 *
 * 「零次出現」才下結論。出現過一次以上就不說話——那可能是真的用了，也可能
 * 只是名字撞到。會錯的那一邊留給人，不留給工具自信地胡說（`check-ai-tasks`
 * 的第一版就是栽在這裡：它從 import 可達性推論，然後回報「取消端點＝發動
 * 介面」）。
 *
 * ## 只有測試在用，算不算有人用
 *
 * 不算，而且單獨列出來。一支只有自己的測試在呼叫的函式，對這個產品來說跟
 * 沒有是一樣的——但它的測試是綠的，所以看起來最安全。
 */

const SRC = 'src'
const TESTS = 'tests'
const SCRIPTS = 'scripts'

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
    if (!/\.(tsx?|mjs)$/.test(entry)) continue
    out.push({
      path: relative(process.cwd(), full).split(sep).join('/'),
      text: readFileSync(full, 'utf8'),
    })
  }

  return out
}

/** 把註解拿掉再掃。我自己的註解提到一個名字，不代表有人呼叫它。 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
}

/**
 * 一個檔案匯出了哪些名字。
 *
 * 只收函式、const、class、type、interface 的具名匯出。`export default` 與
 * `export * from` 不在這裡處理——前者沒有名字可以搜，後者是轉送不是定義。
 */
function exportsOf(text: string): string[] {
  const names = new Set<string>()
  const body = stripComments(text)

  /*
   * 只收**會執行**的東西：函式、常數、類別。
   *
   * 型別刻意不收。一個從來沒有被寫出名字的型別是正常的——回傳值推導、參數
   * 結構、`satisfies`，都用得到它而不會提到它。把型別算進來的那一版回報 297
   * 條，其中絕大多數是雜訊，而**一份充滿雜訊的清單沒有人會看**，那就跟沒有
   * 這支工具一樣。
   */
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /export\s+class\s+([A-Za-z_$][\w$]*)/g,
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(body))) {
      if (match[1]) names.add(match[1])
    }
  }

  return [...names]
}

function main() {
  const src = walk(SRC)
  const tests = walk(TESTS)
  const scripts = walk(SCRIPTS)

  /* ---------------------------------------------------------------- */
  /* 1. 沒有人 import 的匯出                                            */
  /* ---------------------------------------------------------------- */

  /** `lib` 底下的模組才掃：元件由路由渲染，不一定有人 import 它的名字。 */
  const libs = src.filter((file) => file.path.startsWith('src/lib/'))

  const dead: { path: string; name: string }[] = []
  const testOnly: { path: string; name: string }[] = []

  for (const lib of libs) {
    for (const name of exportsOf(lib.text)) {
      // 自己檔案裡用自己不算。
      const others = src.filter((file) => file.path !== lib.path)
      const used = (files: FileText[]) =>
        files.some((file) => new RegExp(`\\b${name}\\b`).test(stripComments(file.text)))

      if (used(others)) continue
      if (used(tests) || used(scripts)) {
        testOnly.push({ path: lib.path, name })
        continue
      }
      dead.push({ path: lib.path, name })
    }
  }

  /* ---------------------------------------------------------------- */
  /* 2. 資料庫欄位沒有任何地方提到                                      */
  /* ---------------------------------------------------------------- */

  const schema = src.filter((file) => file.path.startsWith('src/db/schema/'))
  const nonSchema = src.filter((file) => !file.path.startsWith('src/db/'))

  const unusedColumns: { table: string; column: string }[] = []

  for (const file of schema) {
    const body = stripComments(file.text)

    // 一張表一段：`export const x = pgTable('name', { ... })`
    const tables = body.matchAll(/pgTable\(\s*'([a-z_]+)'\s*,\s*\{([\s\S]*?)\n\s*\}/g)

    for (const table of tables) {
      const tableName = table[1] ?? ''
      const columns = (table[2] ?? '').matchAll(
        /^\s{4}([A-Za-z_$][\w$]*)\s*:\s*[a-zA-Z]+\(/gm
      )

      for (const column of columns) {
        const name = column[1]
        if (!name) continue
        // 每一張表都有的欄位沒有討論價值。
        if (['id', 'createdAt', 'updatedAt', 'deletedAt'].includes(name)) continue

        const seen = nonSchema.some((f) => new RegExp(`\\b${name}\\b`).test(stripComments(f.text)))
        if (!seen) unusedColumns.push({ table: tableName, column: name })
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* 自我檢查，正反各一                                                  */
  /* ---------------------------------------------------------------- */

  const problems: string[] = []

  // 正面：一個到處都在用的名字絕對不可以被判成沒人用。
  if (dead.some((row) => row.name === 'buildContext')) {
    problems.push('buildContext 明明有人用，卻被判成沒人用')
  }
  // 反面：一個不存在的名字必須找不到任何使用者。
  const probe = 'NOT_A_REAL_EXPORT_NAME_PROBE'
  if (src.some((file) => new RegExp(`\\b${probe}\\b`).test(file.text))) {
    problems.push('不存在的名字被判成有人用')
  }
  // 註解裡提到不算使用。
  if (stripComments('// buildContext\nconst x = 1').includes('buildContext')) {
    problems.push('註解沒有被拿掉，提到就會被當成有人用')
  }

  if (problems.length > 0) {
    for (const problem of problems) console.log(`  ✗ 這支工具壞了：${problem}`)
    process.exitCode = 1
    return
  }

  /* ---------------------------------------------------------------- */

  console.log(
    `  掃 ${libs.length} 個 lib 模組、${schema.length} 個 schema 檔（自我檢查通過）\n`
  )

  if (dead.length === 0) {
    console.log('  ✓ 每一個 lib 匯出都有人用')
  } else {
    console.log(`  ✗ ${dead.length} 個匯出沒有任何地方用到：\n`)
    const byFile = new Map<string, string[]>()
    for (const row of dead) {
      byFile.set(row.path, [...(byFile.get(row.path) ?? []), row.name])
    }
    for (const [path, names] of [...byFile].sort()) {
      console.log(`      ${path}`)
      console.log(`        ${names.join('、')}`)
    }
  }

  if (testOnly.length > 0) {
    console.log(`\n  ⚠ ${testOnly.length} 個匯出只有測試或 script 在用：\n`)
    const byFile = new Map<string, string[]>()
    for (const row of testOnly) {
      byFile.set(row.path, [...(byFile.get(row.path) ?? []), row.name])
    }
    for (const [path, names] of [...byFile].sort()) {
      console.log(`      ${path}`)
      console.log(`        ${names.join('、')}`)
    }
  }

  if (unusedColumns.length > 0) {
    console.log(`\n  ✗ ${unusedColumns.length} 個資料庫欄位沒有任何地方提到：\n`)
    const byTable = new Map<string, string[]>()
    for (const row of unusedColumns) {
      byTable.set(row.table, [...(byTable.get(row.table) ?? []), row.column])
    }
    for (const [table, names] of [...byTable].sort()) {
      console.log(`      ${table.padEnd(28)} ${names.join('、')}`)
    }
  } else {
    console.log('\n  ✓ 每一個資料庫欄位至少有一個地方提到')
  }

  /* ---------------------------------------------------------------- */
  /* 基準線：只擋「新的」                                                */
  /* ---------------------------------------------------------------- */

  /*
   * 為什麼要基準線。
   *
   * 不設門檻的話，這支工具就是一份一百多條、沒有人會看的清單——跟沒有它
   * 一樣。但直接拿現況當門檻又會立刻全紅，然後被加進忽略清單，結果還是
   * 一樣。
   *
   * 所以記下**今天已知的這些**，然後只擋新長出來的。已知的那些要清，但那
   * 是另一件事，不該擋住今天的提交；而「又多了一個沒人用的匯出」必須當場
   * 被擋下來——那正是 `TASK_EFFORT`、`approvals.ts`、`model_assignments`
   * 當年溜進來的方式。
   */
  const known = readBaseline()
  const key = (row: { path: string; name: string }) => `${row.path}#${row.name}`

  if (process.argv.includes('--write-baseline')) {
    const lines = [...dead, ...testOnly].map(key).sort()
    writeFileSync(BASELINE, lines.join(NL) + NL, 'utf8')
    console.log(`${NL}  已寫入基準線：${lines.length} 條（${BASELINE}）`)
    return
  }

  const fresh = [...dead, ...testOnly].filter((row) => !known.has(key(row)))

  if (fresh.length > 0) {
    console.log(`${NL}  ✗ ${fresh.length} 個**新的**匯出沒有人用——這是今天長出來的：${NL}`)
    for (const row of fresh) console.log(`      ${row.path}　${row.name}`)
    console.log(
      `${NL}  要嘛接上去，要嘛刪掉。確定它就該先放著的話：${NL}` +
        '    npx tsx scripts/check-dead-wiring.ts --write-baseline'
    )
    process.exitCode = 1
    return
  }

  const stale = [...known].filter(
    (entry) => ![...dead, ...testOnly].some((row) => key(row) === entry)
  )
  if (stale.length > 0) {
    console.log(`${NL}  ✓ 沒有新的。基準線上有 ${stale.length} 條已經清掉了，可以重寫基準線。`)
  } else {
    console.log(`${NL}  ✓ 沒有新的沒人用的匯出`)
  }
}

const BASELINE = 'scripts/dead-wiring-baseline.txt'

/**
 * 換行字元，用常數而不是寫在字串裡。
 *
 * 不是潔癖：我用 shell heredoc 寫這支檔案的時候，`\n` 被某一層吃掉變成真的
 * 換行，於是字串沒有結束、整支編不過。記憶裡本來就有這條（「不要用 heredoc
 * 寫反斜線」），我還是踩了。寫成常數，這條路就不存在。
 */
const NL = String.fromCharCode(10)

function readBaseline(): Set<string> {
  try {
    return new Set(
      readFileSync(BASELINE, 'utf8')
        .split(NL)
        .map((line) => line.trim())
        .filter(Boolean)
    )
  } catch {
    return new Set()
  }
}

main()
