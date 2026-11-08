/**
 * 把一坨文字變成表格 (Z185).
 *
 * 純函式，不碰 `@/db`、不碰 DOM、不碰 Node 的東西——所以同一支在瀏覽器預覽與
 * 伺服器匯入兩邊跑。兩邊同一份程式碼是刻意的：**預覽跟實際匯入長得不一樣**
 * 是這種功能最難查的錯，因為兩邊各自都「看起來對」。
 *
 * `.xlsx` 不在這裡，它要解 zip（`@/lib/import/xlsx`，只能在伺服器端跑）。
 *
 * ## 收哪幾種，為什麼是這幾種
 *
 * | 格式 | 為什麼 |
 * |---|---|
 * | JSON | 叫模型產資料時最自然的輸出 |
 * | JSONL | 一行一筆，長清單時模型比較不會中途壞掉 |
 * | CSV | 所有試算表都匯得出來 |
 * | TSV | **從 Excel／Google 試算表直接複製貼上就是這個** |
 * | Markdown 表格 | 模型在聊天視窗裡預設就吐這個 |
 * | HTML 表格 | 從網頁或 Google 文件複製過來 |
 *
 * 沒收 YAML（要相依）、XML（沒有公認的「一列」長什麼樣）、.docx／.ods（跟
 * xlsx 一樣是 zip 包 XML，但表格藏得更深，等真的有人要再說）。
 */

export type ImportFormat = 'json' | 'jsonl' | 'csv' | 'tsv' | 'markdown' | 'html'

export type ImportSheet = {
  /** 第一列。空白的補上「欄 3」這種名字，因為對應表需要一個能指的東西。 */
  headers: string[]
  /** 其餘每一列，長度一律補齊到 `headers.length`。 */
  rows: string[][]
  format: ImportFormat
}

export class ImportParseError extends Error {}

export const FORMAT_LABEL: Record<ImportFormat, string> = {
  json: 'JSON',
  jsonl: 'JSONL（一行一筆）',
  csv: 'CSV',
  tsv: 'TSV／從試算表貼上',
  markdown: 'Markdown 表格',
  html: 'HTML 表格',
}

/**
 * 猜這坨文字是什麼格式。
 *
 * 順序有講究：先看**結構性的開頭**（`<`、`[`、`{`、`|`），那些誤判率最低；
 * 最後才在 CSV 與 TSV 之間比分隔符數量。
 *
 * CSV／TSV 比的是「第一行裡哪一種多」，不是「有沒有 tab」：一句台詞裡出現
 * tab 很罕見，但出現逗號很常見，用「有沒有」當判準會把 CSV 判成 TSV。
 */
function detectFormat(text: string): ImportFormat {
  const trimmed = stripBom(text).trim()
  if (!trimmed) return 'csv'

  if (/^<(!doctype|html|table|tbody|tr)\b/i.test(trimmed) || /<table[\s>]/i.test(trimmed)) {
    return 'html'
  }
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    // `{...}\n{...}` 是 JSONL，不是壞掉的 JSON。
    return looksLikeJsonl(trimmed) ? 'jsonl' : 'json'
  }
  if (isMarkdownTable(trimmed)) return 'markdown'

  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? ''
  const tabs = (firstLine.match(/\t/g) ?? []).length
  const commas = (firstLine.match(/,/g) ?? []).length
  return tabs > commas ? 'tsv' : 'csv'
}

export function parseSheet(text: string, format = detectFormat(text)): ImportSheet {
  const clean = stripBom(text)
  if (!clean.trim()) throw new ImportParseError('內容是空的')

  switch (format) {
    case 'json':
      return fromRecords(parseJsonRecords(clean), 'json')
    case 'jsonl':
      return fromRecords(parseJsonlRecords(clean), 'jsonl')
    case 'markdown':
      return fromMarkdown(clean)
    case 'html':
      return fromHtml(clean)
    case 'tsv':
      return fromDelimited(clean, '\t', 'tsv')
    default:
      return fromDelimited(clean, ',', 'csv')
  }
}

/** 給 `xlsx.ts` 用：它已經有欄列了，只要套同一套補齊規則。 */
export function sheetFromGrid(grid: string[][], format: ImportFormat): ImportSheet {
  const meaningful = grid.filter((line) => line.some((value) => value.trim() !== ''))
  const [headerRow, ...rest] = meaningful
  if (!headerRow) throw new ImportParseError('找不到標題列')

  const headers = headerRow.map((value, index) => value.trim() || `欄 ${index + 1}`)
  return {
    headers,
    rows: rest.map((line) => headers.map((_, index) => (line[index] ?? '').trim())),
    format,
  }
}

/* -------------------------------------------------------------------------- */

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function looksLikeJsonl(trimmed: string): boolean {
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) return false
  // 每一行都自成一個 JSON 物件，才算 JSONL。
  return lines.every((line) => {
    const value = line.trim()
    if (!value.startsWith('{') || !value.endsWith('}')) return false
    try {
      JSON.parse(value)
      return true
    } catch {
      return false
    }
  })
}

function isMarkdownTable(trimmed: string): boolean {
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim())
  const header = lines.findIndex((line) => line.startsWith('|'))
  if (header === -1) return false
  const divider = lines[header + 1] ?? ''
  // 分隔列：`|---|:--:|---|`
  return /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/.test(divider)
}

/* ---- JSON / JSONL -------------------------------------------------------- */

function parseJsonRecords(text: string): Record<string, unknown>[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new ImportParseError(
      `JSON 讀不進來：${cause instanceof Error ? cause.message : '格式不對'}`
    )
  }

  if (Array.isArray(parsed)) return parsed.filter(isPlainObject)

  if (isPlainObject(parsed)) {
    /*
     * 包了一層的情況。鍵名不寫死成 `rows`：模型會照它被問的東西命名，而「分
     * 鏡」這個請求最常回 `shots`／`scenes`／`data`。取**第一個值是物件陣列的
     * 鍵**比列舉名字可靠。
     */
    for (const value of Object.values(parsed)) {
      if (Array.isArray(value) && value.some(isPlainObject)) return value.filter(isPlainObject)
    }
    return [parsed] // 貼一筆進來是合理的用法。
  }

  throw new ImportParseError('JSON 要是一個陣列，或一個包著陣列的物件')
}

function parseJsonlRecords(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  text.split(/\r?\n/).forEach((line, index) => {
    const value = line.trim()
    if (!value) return
    try {
      const parsed: unknown = JSON.parse(value)
      if (isPlainObject(parsed)) out.push(parsed)
    } catch {
      throw new ImportParseError(`第 ${index + 1} 行不是合法的 JSON`)
    }
  })
  return out
}

/**
 * 物件陣列 → 表格。
 *
 * **欄位取所有列的聯集**，不是第一列的鍵。模型產出的 JSON 常常在沒有值的時
 * 候省略那個鍵——只看第一列的話，第三列才出現的「備註」會整欄消失，而且不會
 * 有任何東西提到它。
 */
function fromRecords(list: Record<string, unknown>[], format: ImportFormat): ImportSheet {
  if (list.length === 0) throw new ImportParseError('裡面沒有任何一列資料')

  const headers: string[] = []
  for (const row of list) {
    for (const key of Object.keys(row)) if (!headers.includes(key)) headers.push(key)
  }
  if (headers.length === 0) throw new ImportParseError('每一列都沒有欄位')

  return { headers, rows: list.map((row) => headers.map((key) => cellToText(row[key]))), format }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 巢狀的值攤平成一格字。
 *
 * 模型偶爾會把「誰說的」寫成 `{ name: '沈知味' }`，或把台詞寫成一個陣列。整
 * 筆丟掉太兇（其餘欄位都是好的），所以攤平：物件取第一個字串值，陣列用換行
 * 接起來。
 */
function cellToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(cellToText).filter(Boolean).join('\n')
  if (isPlainObject(value)) {
    const first = Object.values(value).find(
      (inner) => typeof inner === 'string' || typeof inner === 'number'
    )
    return first === undefined ? '' : String(first)
  }
  return ''
}

/* ---- CSV / TSV ----------------------------------------------------------- */

/**
 * CSV／TSV，照 RFC 4180 的引號規則。
 *
 * 一個字元一個字元走，不用正規表示式：**引號裡的換行**會讓任何「先切行再切
 * 欄」的做法失效，而那正是多行台詞的樣子。用 `split(',')` 的話，一句帶逗號
 * 的台詞會把整列往後推一格——而那不會報錯，它會把台詞存進「誰說的」。
 */
function fromDelimited(text: string, delimiter: string, format: ImportFormat): ImportSheet {
  const table: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!

    if (quoted) {
      if (char !== '"') {
        cell += char
        continue
      }
      // `""` 是一個貨真價實的引號，不是結束。
      if (text[i + 1] === '"') {
        cell += '"'
        i += 1
        continue
      }
      quoted = false
      continue
    }

    if (char === '"' && cell === '') {
      quoted = true
      continue
    }
    if (char === delimiter) {
      row.push(cell)
      cell = ''
      continue
    }
    if (char === '\r') continue
    if (char === '\n') {
      row.push(cell)
      table.push(row)
      row = []
      cell = ''
      continue
    }
    cell += char
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell)
    table.push(row)
  }

  return sheetFromGrid(table, format)
}

/* ---- Markdown ------------------------------------------------------------ */

/**
 * Markdown 表格。
 *
 * 只吃**第一張**表格：一個回答裡有兩張表的時候，第二張通常是說明或範例，而
 * 把兩張接起來會得到一堆欄位對不上的列。
 *
 * 儲存格裡的 `\|` 是跳脫的直線（表格裡要寫直線只能這樣寫），所以先把它換成
 * 一個不可能出現的字再切，切完換回來。
 */
function fromMarkdown(text: string): ImportSheet {
  const SENTINEL = '\u0000'
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  const start = lines.findIndex((line) => line.startsWith('|'))
  if (start === -1) throw new ImportParseError('找不到 Markdown 表格')

  const block: string[] = []
  for (let i = start; i < lines.length; i += 1) {
    if (!lines[i]!.startsWith('|')) break
    block.push(lines[i]!)
  }

  const cells = (line: string) =>
    line
      .replace(/\\\|/g, SENTINEL)
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((value) => value.split(SENTINEL).join('|').trim())

  const rows = block
    // 分隔列（`|---|---|`）丟掉。
    .filter((line) => !/^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/.test(line))
    .map(cells)

  return sheetFromGrid(rows, 'markdown')
}

/* ---- HTML ---------------------------------------------------------------- */

/**
 * HTML 表格。
 *
 * 用正規表示式掃 `<tr>` 與 `<td>/<th>`，**不是**寫一個 HTML 剖析器。這聽起來
 * 像那個著名的壞主意，差別在於這裡只做一件很窄的事：把表格的文字取出來。不
 * 處理巢狀表格、不處理 colspan、不保留任何標籤——取出來的東西只會被當成文
 * 字，不會被渲染，所以剖析不準的後果是「某一格的字怪怪的」，不是安全問題。
 *
 * 只吃第一張表格，理由跟 Markdown 一樣。
 */
function fromHtml(text: string): ImportSheet {
  const table = /<table[\s\S]*?<\/table>/i.exec(text)?.[0]
  if (!table) throw new ImportParseError('找不到 <table>')

  const rows: string[][] = []
  for (const match of table.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const line: string[] = []
    for (const cell of match[0].matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      line.push(htmlCellText(cell[2] ?? ''))
    }
    if (line.length > 0) rows.push(line)
  }

  if (rows.length === 0) throw new ImportParseError('<table> 裡沒有任何一列')
  return sheetFromGrid(rows, 'html')
}

function htmlCellText(html: string): string {
  return decodeEntities(
    html
      // `<br>` 是儲存格裡的換行，不是空白——多行台詞靠它。
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  }
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1]?.toLowerCase() === 'x'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10)
      /*
       * 範圍要擋：`&#x110000;` 讓 `String.fromCodePoint` 丟 `RangeError`，而
       * 那不是 `ImportParseError`——使用者會看到一句英文的內部訊息 (Z190)。
       */
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole
    }
    return named[body.toLowerCase()] ?? whole
  })
}
