import { NextResponse } from 'next/server'
import { ApiError, handle, requireUser } from '@/lib/api'
import { filenameGuide } from '@/lib/import/filename'
import {
  SHEET_FORMAT_EXTENSION,
  SHEET_FORMAT_MIME,
  templateFor,
  templateGuide,
  type SheetFormat,
} from '@/lib/import/sheet-format'
import { importTarget, isImportTargetKey } from '@/lib/import/targets'

export const runtime = 'nodejs'

/**
 * 下載匯入範本與規格 (Z185).
 *
 * 跟 `docs/import/` 裡那一份是**同一個來源**（`targets.ts`），只是一個走網
 * 站、一個留在 repo 裡。重複的是出口，不是內容——所以不會有「網站上的範本跟
 * 文件裡的不一樣」這種事。
 *
 *     ?kind=filenames                  檔名與編碼規格
 *     ?kind=guide&target=shots         某一區的欄位說明
 *     ?target=shots&format=csv         某一區的範本
 */
export const GET = handle(async (request: Request) => {
  await requireUser()

  const url = new URL(request.url)
  const kind = url.searchParams.get('kind')

  if (kind === 'filenames') {
    return download(filenameGuide(), '匯入檔名規格.md', 'text/markdown; charset=utf-8')
  }

  const target = url.searchParams.get('target')
  if (!isImportTargetKey(target)) throw ApiError.badRequest('不認得的匯入區塊')
  const definition = importTarget(target)

  if (kind === 'guide') {
    return download(
      templateGuide(target),
      `${definition.label}-說明.md`,
      'text/markdown; charset=utf-8'
    )
  }

  const format = url.searchParams.get('format') ?? 'csv'
  if (!isSheetFormat(format)) throw ApiError.badRequest('不認得的格式')

  return download(
    templateFor(target, format),
    `${definition.label}-範本.${SHEET_FORMAT_EXTENSION[format]}`,
    SHEET_FORMAT_MIME[format]
  )
})

function isSheetFormat(value: string): value is SheetFormat {
  return value === 'csv' || value === 'tsv' || value === 'json' || value === 'markdown'
}

/**
 * 一律加 UTF-8 BOM。
 *
 * 沒有 BOM 的 UTF-8 CSV 在中文 Windows 的 Excel 裡**開出來是亂碼**——Excel 會
 * 當成系統的 Big5／GBK 讀。加了 BOM 它就認得，而我們自己的匯入會把 BOM 吃
 * 掉，所以不會黏在第一個欄名上。
 */
function download(body: string, filename: string, contentType: string): NextResponse {
  return new NextResponse(`\ufeff${body}`, {
    headers: {
      'content-type': contentType,
      /*
       * RFC 5987。純 ASCII 的 `filename` 是給讀不懂延伸寫法的客戶端用的後
       * 備，而中文檔名沒有東西可以退回去，所以後備用一個通用的字根。
       */
      'content-disposition': `attachment; filename="import-template.${filename.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'cache-control': 'no-store',
    },
  })
}
