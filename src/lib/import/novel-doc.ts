import { foldForSearch } from '@/lib/chinese'

/**
 * 一份小說 Markdown → 集數資訊 + 一堆章節 (Z186).
 *
 * 純函式。表格那一套（`parse.ts`）處理的是「一列一筆」，而小說不是表格——它
 * 是一份有結構的文件，而結構就藏在標題層級裡。所以這一支另外走。
 *
 * ## 認得出來的結構
 *
 * ```md
 * ---
 * 標題: 三文錢的生意
 * 一句話: 身負三兩銀子債務的沈知味…
 * ---
 *
 * # 三文錢的生意          ← 沒有 front-matter 時，第一個 H1 當集名
 *
 * ## 大綱                  ← 這一節的內容進「分集大綱」
 * 開場在東市…
 *
 * ## 第一章　天還沒亮      ← 從這裡開始每一個同層標題是一章
 * 天剛亮，沈知味便被…
 *
 * ## 第二章　三文錢
 * …
 * ```
 *
 * ## 為什麼要有「哪一層是章」這個判斷
 *
 * 模型吐出來的 Markdown 層級不固定：有時候 `#` 是書名、`##` 是章；有時候
 * `#` 就是章。寫死任何一層都會在另一種情況下把整本書變成一章。所以**取出現
 * 次數最多的那一層**當章節層——一本書只有一個書名，但有很多章。
 *
 * ## 認不出結構就是一整章
 *
 * 一份沒有任何標題的純文字會變成「一章，標題留空，全部是內容」。那是對的：
 * 它確實就是一段正文，而硬要從空行猜章節會把對話的空行切成章。
 */

export type NovelDoc = {
  /** 集數層級的欄位，沒寫到的是空字串。 */
  episode: { title: string; logline: string; synopsis: string }
  chapters: { title: string; summary: string; content: string }[]
  /** 給介面顯示：是靠什麼認出章節的。 */
  note: string
}

/** front-matter 與小節標題的別名，兩邊都會折繁簡比對。 */
const KEYS = {
  title: ['標題', '題目', '集名', '書名', 'title'],
  logline: ['一句話', '梗概', '一句話簡介', 'logline', 'hook'],
  synopsis: ['大綱', '分集大綱', '劇情大綱', '摘要', 'synopsis', 'outline', 'summary'],
  summary: ['章節摘要', '本章摘要', '摘要', 'summary'],
}

export function parseNovelMarkdown(text: string): NovelDoc {
  const { meta, body } = splitFrontMatter(text.replace(/\r\n/g, '\n'))

  const episode = {
    title: pick(meta, KEYS.title),
    logline: pick(meta, KEYS.logline),
    synopsis: pick(meta, KEYS.synopsis),
  }

  const blocks = splitHeadings(body)
  if (blocks.length === 0) {
    return {
      episode,
      chapters: [{ title: '', summary: '', content: body.trim() }],
      note: '沒有找到任何標題，整份當成一章。',
    }
  }

  /*
   * 章節在哪一層：出現次數最多的那一層。
   *
   * 一本書只有一個書名，但有很多章——所以次數最多的那一層幾乎一定是章。並列
   * 時取**比較淺的**：`#` 與 `##` 各三個的時候，`#` 是章而 `##` 是章裡的小
   * 節，反過來會把每一章切成好幾章。
   */
  const counts = new Map<number, number>()
  for (const block of blocks) counts.set(block.level, (counts.get(block.level) ?? 0) + 1)
  const chapterLevel = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0] - b[0]
  )[0]![0]

  const chapters: NovelDoc['chapters'] = []
  let pendingSynopsis = ''

  for (const block of blocks) {
    if (block.level < chapterLevel) {
      // 比章還淺的標題：書名／集名。只在 front-matter 沒給的時候採用。
      if (!episode.title) episode.title = block.title
      continue
    }
    if (block.level > chapterLevel) {
      // 比章還深：併回上一章的內容，標題保留成一行。
      const last = chapters.at(-1)
      if (last) last.content += `\n\n${'#'.repeat(block.level)} ${block.title}\n\n${block.body}`
      continue
    }

    // 「大綱」「一句話」那幾節寫進集數，不當成章。
    const kind = classify(block.title)
    if (kind === 'synopsis') {
      pendingSynopsis = block.body.trim()
      continue
    }
    if (kind === 'logline') {
      if (!episode.logline) episode.logline = block.body.trim()
      continue
    }

    chapters.push({ title: block.title, summary: '', content: block.body.trim() })
  }

  if (!episode.synopsis && pendingSynopsis) episode.synopsis = pendingSynopsis

  if (chapters.length === 0) {
    return {
      episode,
      chapters: [{ title: episode.title, summary: '', content: body.trim() }],
      note: '只找到集數層級的標題，整份當成一章。',
    }
  }

  return {
    episode,
    chapters,
    note: `用 ${'#'.repeat(chapterLevel)} 這一層當章節，共 ${chapters.length} 章。`,
  }
}

/* -------------------------------------------------------------------------- */

type Block = { level: number; title: string; body: string }

/**
 * `---` 包起來的 front-matter。
 *
 * 只認最簡單的 `鍵: 值`，不支援巢狀或陣列——模型產出的 front-matter 幾乎都是
 * 平的，而支援 YAML 要一個相依。
 */
function splitFrontMatter(text: string): { meta: Map<string, string>; body: string } {
  const meta = new Map<string, string>()
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  if (!match) return { meta, body: text }

  for (const line of (match[1] ?? '').split('\n')) {
    const pair = /^\s*([^:：]+)\s*[:：]\s*(.*)$/.exec(line)
    if (!pair) continue
    meta.set(fold(pair[1]!), (pair[2] ?? '').trim().replace(/^["']|["']$/g, ''))
  }
  return { meta, body: text.slice(match[0].length) }
}

/** ATX 標題（`# …`）切塊。不認 setext（底線式）——模型不產那種。 */
function splitHeadings(text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  let current: Block | null = null
  let fenced = false

  for (const line of lines) {
    // 程式碼圍欄裡的 `#` 不是標題。小說裡少見，但散文裡貼一段表格就會中。
    if (/^\s*```/.test(line)) fenced = !fenced

    const heading = fenced ? null : /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      if (current) blocks.push(current)
      current = { level: heading[1]!.length, title: heading[2]!.trim(), body: '' }
      continue
    }
    if (current) current.body += `${line}\n`
  }
  if (current) blocks.push(current)
  return blocks
}

/**
 * 比對用的折疊：**要折繁簡**。
 *
 * 模型用簡體回答是常態，而「大纲」認不出來的症狀是整段大綱變成第一章的內文
 * ——它不報錯，而且看起來像是檔案本來就那樣寫的。這裡走跟其他比對同一支
 * `foldForSearch`，所以兩邊的規則只有一份。
 */
function fold(text: string): string {
  return foldForSearch(text.trim())
    .toLowerCase()
    .replace(/[\s_\-（）()]+/g, '')
}

function pick(meta: Map<string, string>, names: readonly string[]): string {
  for (const name of names) {
    const value = meta.get(fold(name))
    if (value) return value
  }
  return ''
}

function classify(title: string): 'synopsis' | 'logline' | null {
  const folded = fold(title)
  if (KEYS.synopsis.some((name) => fold(name) === folded)) return 'synopsis'
  if (KEYS.logline.some((name) => fold(name) === folded)) return 'logline'
  return null
}
