/**
 * 待辦表的里程碑總覽，從條目本身算出來。
 *
 *   npx tsx scripts/todo-milestones.ts          # 印出來
 *   npx tsx scripts/todo-milestones.ts --write  # 同時更新 TODO.md 那一節
 *
 * 存在的理由：一張手動維護的進度表一定會跟條目對不上，而對不上的進度表比
 * 沒有進度表更糟——它看起來像答案。
 *
 * 順便檢查兩件會悄悄出錯的事：
 *
 *  - **編號缺號或重複。** 規則是 Z0 起連續、做完劃掉保留、不重用。
 *  - **側邊欄的里程碑徽章跟待辦表對不上。** `navigation.ts` 決定使用者
 *    看到的 M3／M4 標籤，TODO.md 決定做事的順序；兩邊各說各話的時候，
 *    被騙的是看畫面的人。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const TODO = 'docs/todo/TODO.md'
const NAV = 'src/lib/navigation.ts'
const MILESTONES = ['M0', 'M1', 'M2', 'M3', 'M4'] as const

type Entry = {
  n: number
  done: boolean
  milestone: string | null
  title: string
  /** Z<n> this entry was folded into; it carries no milestone of its own. */
  supersededBy: number | null
}

function parseTodo(text: string): Entry[] {
  const out: Entry[] = []

  /*
   * Split on either ending. `core.autocrlf` is on for this repo, so the
   * working copy of TODO.md can be CRLF — and splitting on '\n' alone leaves
   * a '\r' that the '$' below will not match past, because '\r' is a line
   * terminator in JavaScript regular expressions. The result was not an
   * error: every heading silently stopped matching and the milestone table
   * was rewritten as 0 / 0.
   */
  for (const line of text.split(/\r?\n/)) {
    const match = /^### (~~)?Z(\d+)[　\s]+(.*)$/.exec(line)
    if (!match) continue

    const rest = (match[3] ?? '').replaceAll('~~', '')
    const milestone = /`(M[0-4])`/.exec(rest)

    const superseded = /→\s*看\s*`Z(\d+)`/.exec(rest)

    out.push({
      n: Number(match[2]),
      done: match[1] !== undefined,
      milestone: milestone?.[1] ?? null,
      title: rest.split(/[　\s]*(?:✅|`M|→)/)[0]?.trim() ?? '',
      supersededBy: superseded ? Number(superseded[1]) : null,
    })
  }

  return out
}

function table(entries: Entry[]): string {
  const lines = [
    '## 里程碑總覽',
    '',
    '> 這一節是從下面的條目算出來的，不是另外維護的。改完條目重新算：',
    '> `npx tsx scripts/todo-milestones.ts --write`',
    '',
    '| 里程碑 | 完成 | 合計 | 還沒做的 |',
    '|---|---|---|---|',
  ]

  let done = 0
  let all = 0

  for (const milestone of MILESTONES) {
    const group = entries.filter((e) => e.milestone === milestone)
    if (group.length === 0) continue

    const open = group.filter((e) => !e.done).map((e) => `Z${e.n}`)
    done += group.length - open.length
    all += group.length

    lines.push(
      `| **${milestone}** | ${group.length - open.length} | ${group.length} | ${
        open.join('、') || '（全部完成）'
      } |`
    )
  }

  lines.push(`| | **${done}** | **${all}** | |`)
  return lines.join('\n')
}

/**
 * 「統計」那張表，也從條目算出來.
 *
 * 它本來是手寫的，而它**過期過三次**（11-04、11-05、11-06），每一次都是事後
 * 對帳才抓到。那一節自己附了重算指令，但附指令不等於有人會跑——而這支腳本本
 * 來就已經在走同一批條目了，所以順便把它一起產生。
 *
 * 跟里程碑總覽差的那幾條是**轉址**（「看 Z63」那種指向別條的空條目）：它們不
 * 掛里程碑徽章，不然同一件事會被算兩次。差幾條、是哪幾條，都由這裡算出來，不
 * 是寫死的。
 */
function stats(entries: Entry[]): string {
  const done = entries.filter((e) => e.done).length
  const labelled = entries.filter((e) => e.milestone)
  const unlabelled = entries.filter((e) => !e.milestone && e.supersededBy === null)
  /*
   * `!== null`，不是真假判斷 (Z174 子代理審出來).
   *
   * `supersededBy` 是 `number | null`，而 `Z0` 存在——所以一條「→ 看 `Z0`」的
   * 轉址在真假判斷下會從這裡掉出去，同時被 `report()` 誤報成「沒有里程碑標
   * 籤」。今天踩不到，但它是一個等著發生的錯。
   */
  const redirects = entries.filter((e) => !e.milestone && e.supersededBy !== null)

  /*
   * 差幾條，要把「無標籤也不是轉址」算進去 (Z174).
   *
   * 本來只算轉址，所以一旦有條目忘記掛徽章，這張表就會寫出一句算術錯誤的說
   * 明。`report()` 會把它報成問題，但 `process.exitCode = 1` 發生在
   * `writeFileSync` 之後——檔案已經寫進去了。
   */
  const gap = redirects.length + unlabelled.length

  const parts: string[] = []
  if (redirects.length > 0) {
    parts.push(
      `${redirects.map((e) => 'Z' + e.n).join('／')} 是指向別條的轉址（「看 Z${redirects[0]?.supersededBy ?? '?'}」那種），不掛里程碑徽章，不然會重複計算`
    )
  }
  if (unlabelled.length > 0) {
    parts.push(
      `${unlabelled.map((e) => 'Z' + e.n).join('／')} **忘了掛里程碑徽章**，該補`
    )
  }

  const note =
    gap === 0
      ? '每一條都掛了里程碑徽章，所以這張表跟里程碑總覽的合計一樣。'
      : `跟里程碑總覽的 **${labelled.filter((e) => e.done).length}／${labelled.length}** 差 ${gap} 條：${parts.join('；')}。`

  return [
    '| 狀態 | 數量 |',
    '|---|---|',
    `| 已完成（劃線） | ${done} |`,
    `| 待辦 | ${entries.length - done} |`,
    `| **合計** | **${entries.length}** |`,
    '',
    note,
  ].join('\n')
}

function report(entries: Entry[], nav: string): number {
  let problems = 0

  /* ---- 編號 ------------------------------------------------------------ */

  const numbers = entries.map((e) => e.n).sort((a, b) => a - b)
  const highest = numbers.at(-1) ?? 0
  const missing = Array.from({ length: highest + 1 }, (_, i) => i).filter(
    (i) => !numbers.includes(i)
  )
  const duplicated = [...new Set(numbers)].filter(
    (n) => numbers.filter((m) => m === n).length > 1
  )

  console.log(`編號 Z0–Z${highest}，共 ${entries.length} 條`)
  if (missing.length > 0) {
    console.log(`  ✗ 缺號：${missing.join('、')}`)
    problems += 1
  }
  if (duplicated.length > 0) {
    console.log(`  ✗ 重複：${duplicated.join('、')}`)
    problems += 1
  }
  if (missing.length === 0 && duplicated.length === 0) console.log('  ✓ 連續、不重複')

  /*
   * A superseded entry has no milestone on purpose: it is a kept number
   * pointing at the entry that replaced it. Reporting those as missing a
   * label would train everyone to ignore this check.
   */
  // `=== null`，不是真假判斷：理由同 `stats()` 裡那一段 (Z174)。
  const unlabelled = entries.filter((e) => !e.milestone && e.supersededBy === null)
  if (unlabelled.length > 0) {
    console.log(`  ✗ 沒有里程碑標籤：${unlabelled.map((e) => `Z${e.n}`).join('、')}`)
    problems += 1
  }

  /* ---- 側邊欄徽章 vs 待辦表 -------------------------------------------- */

  console.log('\n側邊欄徽章 vs 待辦表：')
  /*
   * Matched within one object literal, not across them.
   *
   * A lazy `[\s\S]*?` between `label` and `milestone` runs happily past the
   * end of an entry that has no milestone and picks up the next entry's —
   * which reported 工作室儀表板 and 個人設定, both of them shipped and
   * unlabelled, as carrying somebody else's M4.
   */
  const navEntries = [...nav.matchAll(/label: '([^']+)',[^{}]*?milestone: '(M[0-4])'/g)].map(
    (m) => ({ label: m[1]!, milestone: m[2]! })
  )

  /*
   * 沒有東西要比對的時候要說出來 (Z166).
   *
   * 側邊欄現在沒有任何項目掛徽章，於是這個區段什麼都不印——而一個什麼都不印
   * 的檢查看起來就是「一切正常」，分不出「比對過沒問題」與「根本沒比對到東
   * 西」。那正是這支腳本自己在說的「抓不到已知的壞例子就直接說工具壞了」。
   */
  if (navEntries.length === 0) {
    console.log('  ·  側邊欄目前沒有任何項目掛里程碑徽章——沒有東西要比對。')
  }

  for (const item of navEntries) {
    // 標題剛好等於側邊欄文字的那一條才算，避免模糊比對亂配。
    const match = entries.filter((e) => e.title === item.label)
    if (match.length === 0) {
      console.log(`  ·  ${item.label}（${item.milestone}）待辦表沒有同名條目`)
      continue
    }

    const live = match.find((e) => e.milestone) ?? match[0]!
    if (live.milestone === item.milestone) {
      console.log(`  ✓  ${item.label}  ${item.milestone}  = Z${live.n}`)
    } else {
      console.log(
        `  ✗  ${item.label}  側邊欄說 ${item.milestone}，Z${live.n} 說 ${live.milestone}`
      )
      problems += 1
    }
  }

  return problems
}

const OPEN = '<!-- 統計:自動產生 -->'
const CLOSE = '<!-- /統計 -->'

/**
 * 把兩個算出來的區塊套進 TODO.md，回傳套完的全文.
 *
 * **產生與比對共用這一支**，所以「不帶參數時說它過期了」跟「帶 --write 時把它
 * 寫對」不可能分岔。原本只有寫入那一條路，而那正是 TODO.md 自己記著的那個失
 * 敗模式沒有被真正修掉的原因：附一個重算指令，不等於有東西會在它過期時喊。
 *
 * 里程碑總覽整節都是產生出來的，所以「從標題到下一條分隔線」切得乾淨。統計那
 * 一節不是：表格之後還有一段人寫的說明（記著它過期過三次的那一段），而那一段
 * 不該被蓋掉。標記把「機器寫的」跟「人寫的」分開，而且在檔案裡看得見。
 */
function applyTo(source: string, list: Entry[]): string {
  const start = source.indexOf('## 里程碑總覽')
  if (start === -1) {
    console.error('\nTODO.md 裡沒有「## 里程碑總覽」這一節，不知道要換掉哪裡')
    process.exit(1)
  }

  const end = source.indexOf('\n---', start)
  const withTable = source.slice(0, start) + table(list) + '\n' + source.slice(end)

  const from = withTable.indexOf(OPEN)
  const to = withTable.indexOf(CLOSE)
  if (from === -1 || to === -1 || to < from) {
    /*
     * 訊息要說清楚**兩節都沒更新** (Z174).
     *
     * 兩節共用同一次寫入，所以標記壞掉的時候里程碑總覽也不會被寫進去——原本
     * 的訊息只說「統計那一節沒有更新」，讀的人會以為另一節是好的。
     */
    console.error(
      `\nTODO.md 裡找不到成對的 ${OPEN} / ${CLOSE}。\n兩節都沒有更新——它們共用同一次寫入。`
    )
    process.exit(1)
  }

  return (
    withTable.slice(0, from + OPEN.length) +
    '\n' +
    stats(list) +
    '\n' +
    withTable.slice(to)
  )
}

const text = readFileSync(TODO, 'utf8')
const entries = parseTodo(text)

console.log(`${table(entries)}\n`)
let problems = report(entries, readFileSync(NAV, 'utf8'))

const next = applyTo(text, entries)

if (process.argv.includes('--write')) {
  if (next === text) console.log('\nTODO.md 的兩張表本來就是對的，沒有改動。')
  else {
    writeFileSync(TODO, next, 'utf8')
    console.log('\n已更新 TODO.md 的里程碑總覽與統計')
  }
} else if (next !== text) {
  /*
   * 不帶參數就是檢查，所以它要能失敗 (Z174).
   *
   * 這一支掛進 `npm run check`，於是「改完條目忘記重算」會在提交門檻上停下
   * 來。在那之前 TODO.md 寫著「忘記重算這個失敗模式沒有了」——而那句話是假
   * 的：它只是從記得跑三個指令變成記得跑一個指令。
   */
  console.log(
    '\n  ✗ TODO.md 的里程碑總覽或統計表跟條目對不上。重算：\n      npx tsx scripts/todo-milestones.ts --write'
  )
  problems += 1
}

if (problems > 0) {
  console.log(`\n有 ${problems} 類對不上的地方。`)
  process.exitCode = 1
}
