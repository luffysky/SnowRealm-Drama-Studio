import { inflateRawSync } from 'node:zlib'
import { ImportParseError, sheetFromGrid, type ImportSheet } from '@/lib/import/parse'

/**
 * 讀 `.xlsx`，不加任何相依 (Z185).
 *
 * ## 為什麼自己剖，而不是裝一個套件
 *
 * 這個生態裡最通用的那一個（SheetJS）在 npm 上的版本有已知的原型污染問題，
 * 而沒有那些問題的新版只在它自己的 CDN 上——鎖不進 `package.json`，也不會進
 * 任何稽核。為了讀一張表格把那個扛進來，代價不對。
 *
 * 而 `.xlsx` 其實是一個 **zip 包著幾份 XML**，我們要的只有兩份：工作表本身，
 * 加上一張共用字串表。zip 的中央目錄加上 `inflateRaw` 就夠了，Node 內建。
 *
 * ## 這一支**不做**什麼
 *
 * 公式不算（取快取的值）、樣式不看、日期不轉（Excel 的日期是一個序號，而一
 * 個「2026-01-03」跟「45660」長得完全不一樣——猜錯比留著原樣糟）、只讀第一
 * 張工作表。這些限制在介面上要寫出來。
 *
 * 加密的檔案讀不了，而且會是一個看不懂的錯誤——所以先認出來並講人話。
 */

/** 一個 zip 條目：名字與它解開之後的位元組。 */
type ZipEntry = { name: string; data: Buffer }

/**
 * Excel 的欄數上限是 XFD（16384）。
 *
 * **沒有這個上限會讓整個程序死掉** (Z190)：欄位址是從 `r="C7"` 的字母算出來
 * 的，而 `AAAAAA1` 算出來是三億——然後那一列會被配成一個三億筆的陣列，Node
 * 直接 OOM。那是 **FATAL ERROR 不是例外**，try/catch 救不了，函式實例跟著
 * 死。一個幾百 bytes 的檔案就做得到。
 */
const MAX_COLUMNS = 16384

/** 一個 zip 條目解開之後的上限。 */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024

/**
 * 我們真正會讀的那幾份。
 *
 * `readZip` 原本把**每一個** entry 都解開，而 `.xlsx` 是個 zip——一個 8MB 的
 * 檔案可以展開成好幾 GB（實測壓縮比 1029:1）。只解要用的那幾份，放大器就沒
 * 了。
 */
const WANTED = /^(xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/worksheets\/[^/]+\.xml|EncryptedPackage)$/

export function parseXlsx(file: Buffer): ImportSheet {
  if (file.length < 4 || file.readUInt32LE(0) !== 0x04034b50) {
    throw new ImportParseError('這不是一個 .xlsx 檔（連 zip 的開頭都不是）')
  }

  const entries = readZip(file)
  const byName = new Map(entries.map((entry) => [entry.name, entry.data]))

  if (byName.has('EncryptedPackage')) {
    throw new ImportParseError('這個 Excel 檔有密碼保護，請先移除密碼再匯入')
  }

  const sheetName = firstSheetPath(byName)
  const sheetXml = byName.get(sheetName)
  if (!sheetXml) throw new ImportParseError('這個 Excel 檔裡找不到工作表')

  const shared = byName.get('xl/sharedStrings.xml')
  const strings = shared ? readSharedStrings(shared.toString('utf8')) : []

  return sheetFromGrid(readSheet(sheetXml.toString('utf8'), strings), 'csv')
}

/* -------------------------------------------------------------------------- */

/**
 * 從中央目錄讀 zip。
 *
 * 不從頭掃區域檔頭：那一份的大小欄位在串流寫出的檔案裡可以是 0（真正的值在
 * 資料後面的 data descriptor），而中央目錄一定是對的。Excel 寫出來的檔正好
 * 常常是串流寫的。
 */
function readZip(file: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(file)
  const count = file.readUInt16LE(eocd + 10)
  let offset = file.readUInt32LE(eocd + 16)

  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i += 1) {
    /*
     * 每一次讀之前先驗界。損壞或惡意的 zip 會讓位移指到檔案外面，而
     * `readUInt32LE` 丟的是 Node 的 `RangeError: offset is out of range`
     * ——攔得住，但使用者看到的是一句英文的內部訊息。
     */
    if (offset < 0 || offset + 46 > file.length) break
    if (file.readUInt32LE(offset) !== 0x02014b50) break

    const method = file.readUInt16LE(offset + 10)
    const compressedSize = file.readUInt32LE(offset + 20)
    const nameLength = file.readUInt16LE(offset + 28)
    const extraLength = file.readUInt16LE(offset + 30)
    const commentLength = file.readUInt16LE(offset + 32)
    const localOffset = file.readUInt32LE(offset + 42)
    const name = file.toString('utf8', offset + 46, offset + 46 + nameLength)

    // 區域檔頭的長度欄位自己也要讀一次——它的 extra 欄位跟中央目錄的不一樣長。
    if (localOffset < 0 || localOffset + 30 > file.length) break
    const localNameLength = file.readUInt16LE(localOffset + 26)
    const localExtraLength = file.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const raw = file.subarray(start, start + compressedSize)

    /*
     * 只解我們要的那幾份，而且給解開之後的大小一個上限。
     *
     * 兩個放大器：原本每一個 entry 都解（.xlsx 裡可能有一堆圖片與主題
     * 檔），而 deflate 的壓縮比可以到千倍。`maxOutputLength` 超過會丟例外，
     * 而那是可以攔的——比 OOM 好。
     */
    if (WANTED.test(name)) {
      if (method === 0) entries.push({ name, data: Buffer.from(raw) })
      else if (method === 8) {
        entries.push({ name, data: inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES }) })
      }
      // 其他壓縮法（bzip2、lzma）Excel 不會用，跳過比炸掉好。
    }

    offset += 46 + nameLength + extraLength + commentLength
  }

  if (entries.length === 0) throw new ImportParseError('這個 .xlsx 是空的，或壓縮格式不支援')
  return entries
}

/**
 * 從尾端找 EOCD。
 *
 * 它的位置不固定，因為後面可以接一段註解（最長 65535）。所以從最後往回找那
 * 四個位元組的簽章。
 */
function findEndOfCentralDirectory(file: Buffer): number {
  if (file.length < 22) throw new ImportParseError('這個檔案太小，不是一個 zip')
  const floor = Math.max(0, file.length - 22 - 0xffff)
  for (let i = file.length - 22; i >= floor; i -= 1) {
    if (file.readUInt32LE(i) === 0x06054b50) return i
  }
  throw new ImportParseError('這個 zip 讀不到目錄，檔案可能壞了')
}

/**
 * 第一張工作表的路徑。
 *
 * 「第一張」指的是**活頁簿裡的順序**，不是檔名的順序——`sheet1.xml` 不保證
 * 是第一個分頁（刪掉再新增就會錯位）。所以先讀 `workbook.xml` 的順序，再透
 * 過關聯檔對到實際路徑；對不到才退回檔名排序。
 */
function firstSheetPath(byName: Map<string, Buffer>): string {
  const workbook = byName.get('xl/workbook.xml')?.toString('utf8')
  const rels = byName.get('xl/_rels/workbook.xml.rels')?.toString('utf8')

  if (workbook && rels) {
    const rid = /<sheet\b[^>]*r:id="([^"]+)"/i.exec(workbook)?.[1]
    if (rid) {
      const target = new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`, 'i').exec(rels)?.[1]
      if (target) {
        const path = target.startsWith('/')
          ? target.slice(1)
          : `xl/${target.replace(/^\.\//, '')}`
        if (byName.has(path)) return path
      }
    }
  }

  const fallback = [...byName.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort()
  if (fallback[0]) return fallback[0]
  throw new ImportParseError('這個 Excel 檔裡找不到工作表')
}

/**
 * 共用字串表。
 *
 * Excel 把重複的文字抽出來存一份，儲存格只放索引。一個 `<si>` 裡可能有好幾
 * 個 `<t>`（同一格裡有不同格式的片段），要接起來——不接的話「沈知味**推開
 * 門**」會只剩「沈知味」。
 */
function readSharedStrings(xml: string): string[] {
  const out: string[] = []
  for (const item of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
    const parts = [...(item[1] ?? '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((t) =>
      decodeXml(t[1] ?? '')
    )
    out.push(parts.join(''))
  }
  return out
}

/**
 * 工作表的格子。
 *
 * 用 `r="C7"` 這個位址欄來定位，不是數到第幾個 `<c>`：**空白的格子整個不會
 * 出現在 XML 裡**，所以數個數會讓一整列從空格那裡開始往左移一位。
 */
function readSheet(xml: string, shared: string[]): string[][] {
  const grid: string[][] = []

  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gi)) {
    /*
     * `r="0"` 不合法（Excel 的列從 1 開始），而算出來的 -1 會讓那一列靜靜消
     * 失——`grid[-1]` 是物件屬性，不是索引。接在最後面比丟掉好。
     */
    const declared = Number(/r="(\d+)"/i.exec(rowMatch[1] ?? '')?.[1] ?? '0')
    const rowIndex = declared >= 1 ? declared - 1 : grid.length
    const line: string[] = []

    for (const cellMatch of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const attrs = cellMatch[1] ?? ''
      const body = cellMatch[2] ?? ''
      const column = columnIndex(/r="([A-Z]+)\d+"/i.exec(attrs)?.[1] ?? '')
      const type = /t="([^"]+)"/i.exec(attrs)?.[1] ?? 'n'

      let text = ''
      if (type === 's') {
        const index = Number(/<v>([\s\S]*?)<\/v>/i.exec(body)?.[1] ?? '-1')
        text = shared[index] ?? ''
      } else if (type === 'inlineStr') {
        text = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
          .map((t) => decodeXml(t[1] ?? ''))
          .join('')
      } else {
        // 數字、布林，以及**公式的快取值**——`<f>` 不算，算出來的那個才算。
        text = decodeXml(/<v>([\s\S]*?)<\/v>/i.exec(body)?.[1] ?? '')
      }

      // 超出 Excel 自己的欄數上限：那不是一張真的試算表（見 `MAX_COLUMNS`）。
      if (column >= 0 && column < MAX_COLUMNS) line[column] = text
    }

    grid[rowIndex] = fillCells(line)
  }

  /*
   * 列也要補。`r="5"` 的列前面可能完全沒有 `<row>`（整列空白），而稀疏陣列
   * 的洞在後面每一個 `.map` 都要再防一次。
   */
  const dense: string[][] = []
  for (let i = 0; i < grid.length; i += 1) dense[i] = grid[i] ?? []
  return dense
}

/** 稀疏的一列補成密集的，`undefined` 換成空字串。 */
function fillCells(line: (string | undefined)[]): string[] {
  const out: string[] = []
  for (let i = 0; i < line.length; i += 1) out[i] = line[i] ?? ''
  return out
}

/** `AB` → 27。 */
function columnIndex(letters: string): number {
  if (!letters) return -1
  let value = 0
  for (const char of letters.toUpperCase()) {
    value = value * 26 + (char.charCodeAt(0) - 64)
  }
  return value - 1
}

function codePoint(code: number, fallback: string): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : fallback
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    /*
     * 範圍要擋。`&#x110000;` 讓 `String.fromCodePoint` 丟 `RangeError`，而那
     * 不是 `ImportParseError`——使用者會看到一句英文的內部訊息。超出範圍的就
     * 原樣留著。
     */
    .replace(/&#x([0-9a-f]+);/gi, (whole, hex: string) => codePoint(Number.parseInt(hex, 16), whole))
    .replace(/&#(\d+);/g, (whole, dec: string) => codePoint(Number(dec), whole))
    // `&amp;` 要最後換，不然 `&amp;lt;` 會變成 `<`。
    .replace(/&amp;/g, '&')
}
