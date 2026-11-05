import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { AI_JOB_KINDS, AI_JOB_KIND_LABEL } from '../src/lib/constants'
import { BATCH_TASKS } from '../src/lib/ai/batch-view'

/**
 * 每一種 AI 任務，介面上有沒有地方發動得了 (Z149).
 *
 * 待辦表上重複出現同一句話：**「任務與 prompt 都已存在，缺介面」**。
 * Z64（作品企劃）、Z69（世界觀生成）、Z70（角色生成）、Z72（素材生成）、
 * Z73（任務建議）全是這一條。那不是五個功能各自沒做，是**同一個病出現
 * 五次**：後端定義好了、有 prompt、有定價、進得了佇列，就是沒有人按得到。
 *
 * ## 為什麼不用 import 可達性
 *
 * 第一版從「寫出這個種類的檔案」往回走 import，想找到介面。那個版本**自信
 * 地胡說**：
 *
 *     NOVEL_TO_AUDIO   經由 /api/ai/jobs/*\/cancel（AiInbox.tsx）
 *
 * 取消一個任務當然不是發動它。問題在於通用端點（`/api/ai/jobs` 收任何種類）
 * 與生命週期端點（取消、採用、收件匣）會碰到每一種任務，所以**每一種都走
 * 得到**——用它當證據，這支工具會永遠回報「全部接好了」。
 *
 * ## 可信的訊號只有一個
 *
 * **介面把它當成任務送出去。** 兩種形式：
 *
 *  1. 介面檔裡寫 `kind: 'X'` / `task: 'X'`——給使用者挑的清單就長這樣。
 *  2. 專用的發動路徑，下面那張表一條一條列出來，每條寫理由。
 *
 * 「提到」不算。`task === 'PROJECT_PLAN'` 是判斷式，
 * `adapterForTask('OUTLINE_GENERATE')` 是在問供應商好了沒——第一版把這兩個
 * 都當成「有介面」。
 */

const SRC = 'src'

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

/**
 * 專用的發動路徑：介面上有一顆按鈕，按下去就是排這一種任務。
 *
 * 這些的種類字串寫在 lib 裡（路由只是呼叫 `enqueueX()`），所以掃不到。
 * **一條一條列出來並寫理由**，而不是讓工具去猜——猜出來的那一版把取消
 * 端點當成了發動端點。
 */
const DEDICATED: { kind: string; where: string; why: string }[] = [
  {
    kind: 'DIALOGUE_ATTRIBUTE',
    where: 'AudiobookPanel.tsx',
    why: '「判斷對白是誰說的」按鈕 → /attribution',
  },
  {
    kind: 'NOVEL_TO_AUDIO',
    where: 'AudiobookPanel.tsx',
    why: '「產生有聲書」按鈕 → /audiobook',
  },
]

/** 介面檔：使用者看得到的畫面，不含 api 與 lib。 */
const isUi = (path: string) =>
  !path.startsWith('src/app/api/') &&
  (path.startsWith('src/components/') || path.startsWith('src/app/'))

function main() {
  const ui = walk(SRC).filter((file) => isUi(file.path))

  /** 種類 → 在哪裡發動得了。 */
  const reach = new Map<string, string>()

  const launchSite = (kind: string): string | null => {
    // 屬性賦值，不是裸字串——「提到」不等於「送得出去」。
    const launches = new RegExp(`\\b(?:kind|task|initialTask)\\s*:\\s*['"\`]${kind}['"\`]`)
    const file = ui.find((row) => launches.test(row.text))
    return file ? `任務清單：${file.path}` : null
  }

  for (const kind of AI_JOB_KINDS) {
    const site = launchSite(kind)
    if (site) {
      reach.set(kind, site)
      continue
    }

    if ((BATCH_TASKS as readonly string[]).includes(kind)) {
      reach.set(kind, '批次生成（BATCH_TASKS）')
      continue
    }

    const dedicated = DEDICATED.find((row) => row.kind === kind)
    if (dedicated) reach.set(kind, `${dedicated.where}：${dedicated.why}`)
  }

  /*
   * 自我檢查，正反各一。
   *
   * 正面：`NOVEL_CONTINUE` 真的在小說編輯器的清單裡。
   * 反面：一個不存在的種類必須找不到——不然這支工具只是會說「沒問題」。
   */
  const problems: string[] = []
  if (!reach.has('NOVEL_CONTINUE')) problems.push('NOVEL_CONTINUE 明明在清單裡，卻判成沒接線')
  if (launchSite('NOT_A_REAL_TASK_KIND_PROBE')) problems.push('不存在的種類被判成有介面')

  if (problems.length > 0) {
    for (const problem of problems) console.log(`  ✗ 這支工具壞了：${problem}`)
    process.exitCode = 1
    return
  }

  const missing = AI_JOB_KINDS.filter((kind) => !reach.has(kind))

  console.log(
    `  ${AI_JOB_KINDS.length} 種 AI 任務，${reach.size} 種發動得了（自我檢查通過）\n`
  )

  for (const [kind, how] of reach) {
    console.log(`      ✓ ${kind.padEnd(22)} ${how}`)
  }

  if (missing.length === 0) return

  console.log(`\n  ✗ ${missing.length} 種有 prompt、有定價、進得了佇列，但介面上發動不了：\n`)
  for (const kind of missing) {
    console.log(`      ${kind.padEnd(22)} ${AI_JOB_KIND_LABEL[kind] ?? ''}`)
  }

  process.exitCode = 1
}

main()
