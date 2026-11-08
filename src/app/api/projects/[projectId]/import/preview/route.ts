import { ApiError, handle, jsonOk, requireUser } from '@/lib/api'
import { decodeBytes } from '@/lib/import/decode'
import { readFilename } from '@/lib/import/filename'
import { buildMapContext } from '@/lib/import/apply'
import { detectMapping, mapRows } from '@/lib/import/map'
import { parseNovelMarkdown } from '@/lib/import/novel-doc'
import { parseSheet, type ImportSheet } from '@/lib/import/parse'
import { importTarget, isImportTargetKey, type ImportTargetKey } from '@/lib/import/targets'
import { parseXlsx } from '@/lib/import/xlsx'
import { requireProjectApi } from '@/lib/project-access'

export const runtime = 'nodejs'

/** 一次最多幾個檔案、單檔多大。 */
const MAX_FILES = 20
const MAX_BYTES = 8 * 1024 * 1024

/**
 * 看一眼要匯入什麼，**還不寫** (Z185).
 *
 * 一次收很多個檔案：每一個都回「猜它是哪一區的」「欄位對到什麼」「哪幾列有問
 * 題」。介面把這些攤開讓人改，確認之後才呼叫 `apply`。
 *
 * ## 為什麼解析在伺服器端
 *
 * `.xlsx` 要解 zip（`node:zlib`），而編碼偵測要拿到**原始位元組**——
 * `File.text()` 一律當 UTF-8 解，中文 Windows 的 Excel 存的 CSV 是 Big5 或
 * GBK，那樣讀進來每一格都是問號。而且那種壞法**過得了驗證**：亂碼是合法的字
 * 串，所以會一路寫進資料庫。
 *
 * ## 回傳整張表，不只前幾列
 *
 * `apply` 吃的是這裡回去的那張表，所以不必在伺服器端存狀態，也不必要求使用者
 * 再上傳一次。代價是一份資料在網路上跑兩趟——對一份兩百列的鏡頭表來說，那比
 * 「伺服器記著你剛才傳了什麼」簡單太多。
 */
export const POST = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requireUser()
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const form = await request.formData().catch(() => null)
    if (!form) throw ApiError.badRequest('請用檔案上傳的方式送出')

    const files = form.getAll('files').filter((item): item is File => item instanceof File)
    const pasted = form.get('text')
    const forced = form.get('target')

    if (files.length === 0 && typeof pasted !== 'string') {
      throw ApiError.badRequest('沒有收到任何檔案')
    }
    if (files.length > MAX_FILES) {
      throw ApiError.badRequest(`一次最多 ${MAX_FILES} 個檔案`)
    }

    const mapContext = await buildMapContext(projectId)
    const results: unknown[] = []

    const sources: { name: string; bytes: Uint8Array | null; text: string | null }[] = []
    for (const file of files) {
      if (file.size > MAX_BYTES) {
        results.push({
          filename: file.name,
          error: `超過 ${Math.round(MAX_BYTES / 1024 / 1024)} MB`,
        })
        continue
      }
      sources.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), text: null })
    }
    if (typeof pasted === 'string' && pasted.trim()) {
      sources.push({ name: '貼上的內容', bytes: null, text: pasted })
    }

    for (const source of sources) {
      try {
        const hints = readFilename(source.name)
        const target = pickTarget(forced, hints.target)

        let sheet: ImportSheet
        let encoding = 'utf-8'
        let encodingNote: string | null = null

        if (source.bytes && isXlsx(source.name, source.bytes)) {
          sheet = parseXlsx(Buffer.from(source.bytes))
          encoding = 'xlsx'
        } else {
          const decoded = source.bytes
            ? decodeBytes(source.bytes)
            : { text: source.text ?? '', encoding: 'utf-8', note: null }
          encoding = decoded.encoding
          encodingNote = decoded.note

          /*
           * 小說是**文件**，不是表格 (Z186).
           *
           * 一份帶標題的 Markdown 丟進表格剖析器，會得到一欄幾百列的垃圾——
           * 而它不會報錯。所以先看它像不像散文：有 ATX 標題，或者剖出來只有
           * 一欄。兩個條件都成立才轉過去，因為「一欄的 CSV」也可能真的是一欄
           * 的 CSV。
           */
          if (target === 'chapters' && looksLikeProse(decoded.text)) {
            const doc = parseNovelMarkdown(decoded.text)
            results.push({
              filename: source.name,
              mode: 'document',
              encoding,
              encodingNote,
              target,
              matched: hints.matched,
              episodeNumber: hints.episodeNumber,
              docText: decoded.text,
              episode: doc.episode,
              chapters: doc.chapters.map((chapter) => ({
                title: chapter.title,
                chars: chapter.content.replace(/\s/g, '').length,
              })),
              note: doc.note,
            })
            continue
          }

          sheet = parseSheet(decoded.text)
        }

        if (!target) {
          results.push({
            filename: source.name,
            sheet,
            encoding,
            encodingNote,
            target: null,
            episodeNumber: hints.episodeNumber,
            defaults: hints.defaults,
            matched: hints.matched,
            needsTarget: true,
          })
          continue
        }

        const definition = importTarget(target)
        const mapping = detectMapping(sheet.headers, definition)
        const withDefaults = applyFilenameDefaults(sheet, mapping, hints.defaults)
        const mapped = mapRows(withDefaults.sheet, withDefaults.mapping, definition, mapContext)

        results.push({
          filename: source.name,
          sheet: withDefaults.sheet,
          encoding,
          encodingNote,
          target,
          matched: hints.matched,
          episodeNumber: hints.episodeNumber,
          mapping: withDefaults.mapping,
          unmapped: definition.fields
            .filter((field) => !withDefaults.mapping.includes(field.key))
            .map((field) => field.label),
          preview: mapped.rows.slice(0, 20),
          counts: { ready: mapped.rows.length, skipped: mapped.skipped.length },
          issues: mapped.issues.slice(0, 80),
          newVocabulary: mapped.newVocabulary,
        })
      } catch (cause) {
        results.push({
          filename: source.name,
          error: cause instanceof Error ? cause.message : '讀不進來',
        })
      }
    }

    return jsonOk({ files: results })
  }
)

function pickTarget(
  forced: FormDataEntryValue | null,
  guessed: ImportTargetKey | null
): ImportTargetKey | null {
  if (typeof forced === 'string' && isImportTargetKey(forced)) return forced
  return guessed
}

/**
 * 檔名給的預設值變成多出來的一欄。
 *
 * `分鏡-EP001-S03.csv` 裡的 `S03` 只在**內容沒有那一欄**時才補——檔名是補
 * 充，不是覆蓋。做法是在表格右邊接一欄常數，這樣後面的對應與驗證完全不必知
 * 道「這個值是從檔名來的」。
 */
function applyFilenameDefaults(
  sheet: ImportSheet,
  mapping: (string | null)[],
  defaults: Record<string, string>
): { sheet: ImportSheet; mapping: (string | null)[] } {
  const missing = Object.entries(defaults).filter(([key]) => !mapping.includes(key))
  if (missing.length === 0) return { sheet, mapping }

  return {
    sheet: {
      ...sheet,
      headers: [...sheet.headers, ...missing.map(([key]) => `（檔名）${key}`)],
      rows: sheet.rows.map((row) => [...row, ...missing.map(([, value]) => value)]),
    },
    mapping: [...mapping, ...missing.map(([key]) => key)],
  }
}

/**
 * 這份文字像散文，還是像表格。
 *
 * 有 ATX 標題就幾乎一定是散文；沒有標題的話看剖出來有幾欄——一欄的東西當表
 * 格處理是沒有意義的。兩種訊號都不足以單獨下判斷，所以取聯集而不是交集會太
 * 鬆：一份帶 Markdown 表格的 `.md` 有標題也有多欄，那它是表格。
 */
function looksLikeProse(text: string): boolean {
  const hasHeadings = /^#{1,6}\s+\S/m.test(text)
  const hasTable = /^\s*\|.*\|\s*$/m.test(text)
  if (hasTable) return false
  if (hasHeadings) return true

  try {
    return parseSheet(text).headers.length <= 1
  } catch {
    return true
  }
}

/** zip 的開頭，或副檔名。 */
function isXlsx(name: string, bytes: Uint8Array): boolean {
  if (/\.xlsx$/i.test(name)) return true
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}
