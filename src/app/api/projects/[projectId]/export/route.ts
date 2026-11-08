import { NextResponse } from 'next/server'
import { ApiError, handle, requireUser } from '@/lib/api'
import { convertScript, isScriptPreference, type ScriptPreference } from '@/lib/chinese'
import { exportRows } from '@/lib/import/export'
import {
  SHEET_FORMAT_EXTENSION,
  SHEET_FORMAT_MIME,
  writeSheet,
  type SheetFormat,
} from '@/lib/import/sheet-format'
import { importTarget, isImportTargetKey } from '@/lib/import/targets'
import { requireProjectApi } from '@/lib/project-access'

export const runtime = 'nodejs'

/**
 * 把現有資料倒出來 (Z185).
 *
 * 欄位跟匯入完全一樣，所以倒出來的檔案可以改一改再匯回去，也可以直接貼給模型
 * 當「現況」。
 *
 *     ?target=shots&episodeId=…&format=csv&script=traditional
 *
 * `script` 是**字形**：`original`（預設，原樣倒出來）、`traditional`、
 * `simplified`。
 *
 * 印成 PDF 走另一條路（`/projects/<id>/print`）：PDF 要嵌中文字型，而瀏覽器
 * 自己的列印引擎本來就會做這件事——在伺服器端重做一次要扛一份幾 MB 的字型檔，
 * 換來的是比較差的排版。
 */
export const GET = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requireUser()
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const url = new URL(request.url)
    const target = url.searchParams.get('target')
    if (!isImportTargetKey(target)) throw ApiError.badRequest('不認得的匯出區塊')

    const format = url.searchParams.get('format') ?? 'csv'
    if (!isSheetFormat(format)) throw ApiError.badRequest('不認得的格式')

    const definition = importTarget(target)
    const table = await exportRows(target, {
      projectId,
      episodeId: url.searchParams.get('episodeId'),
    })

    /*
     * 字形轉換 (Z187).
     *
     * 這本書的原文是簡體，而讀稿的人讀繁體——所以「倒出來給人看」常常要轉一
     * 次。走 `convertScript`，所以簡 → 繁 那個方向的防護（繁體獨有字就別碰）
     * 跟介面那一套是同一份。
     *
     * **轉過的檔案再匯回來會把轉換結果存進資料庫**，而簡 → 繁 是一對多、轉不
     * 回去的。這一點寫在介面上那顆選擇器旁邊；要拿去改再匯回來的話，選「原
     * 文」。
     */
    const script = url.searchParams.get('script') ?? 'original'
    if (!isScriptPreference(script)) throw ApiError.badRequest('不認得的字形')

    const converted =
      script === 'original'
        ? table
        : {
            headers: table.headers.map((head) => convertScript(head, script as ScriptPreference)),
            rows: table.rows.map((row) =>
              row.map((cell) => convertScript(cell, script as ScriptPreference))
            ),
          }

    const body = writeSheet(converted.headers, converted.rows, format)
    const filename = `${definition.label}.${SHEET_FORMAT_EXTENSION[format]}`

    /*
     * UTF-8 BOM：沒有它的話，中文 Windows 的 Excel 會當成 Big5／GBK 讀，開出
     * 來整張表是亂碼。我們自己的匯入會把 BOM 吃掉，所以來回一趟不會壞。
     */
    return new NextResponse(`\ufeff${body}`, {
      headers: {
        'content-type': SHEET_FORMAT_MIME[format],
        'content-disposition': `attachment; filename="export.${SHEET_FORMAT_EXTENSION[format]}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'cache-control': 'no-store',
      },
    })
  }
)

function isSheetFormat(value: string): value is SheetFormat {
  return value === 'csv' || value === 'tsv' || value === 'json' || value === 'markdown'
}
