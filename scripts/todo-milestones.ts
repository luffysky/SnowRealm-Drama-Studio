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

  for (const line of text.split('\n')) {
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
  const unlabelled = entries.filter((e) => !e.milestone && !e.supersededBy)
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

const text = readFileSync(TODO, 'utf8')
const entries = parseTodo(text)
const built = table(entries)

console.log(`${built}\n`)
const problems = report(entries, readFileSync(NAV, 'utf8'))

if (process.argv.includes('--write')) {
  const start = text.indexOf('## 里程碑總覽')
  if (start === -1) {
    console.error('\nTODO.md 裡沒有「## 里程碑總覽」這一節，不知道要換掉哪裡')
    process.exit(1)
  }
  const end = text.indexOf('\n---', start)
  writeFileSync(TODO, text.slice(0, start) + built + '\n' + text.slice(end), 'utf8')
  console.log('\n已更新 TODO.md 的里程碑總覽')
}

if (problems > 0) {
  console.log(`\n有 ${problems} 類對不上的地方。`)
  process.exitCode = 1
}
