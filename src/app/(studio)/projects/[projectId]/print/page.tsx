import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { PrintNow } from '@/components/studio/PrintNow'
import { getSessionUser } from '@/lib/auth/session'
import { convertScript, isScriptPreference } from '@/lib/chinese'
import { exportRows } from '@/lib/import/export'
import { importTarget, isImportTargetKey } from '@/lib/import/targets'
import { requireProjectPage } from '@/lib/project-access'

export const metadata: Metadata = { title: '列印' }

type Params = {
  params: Promise<{ projectId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * 一頁乾淨的版面，拿去列印或另存 PDF (Z187).
 *
 * ## 為什麼不是在伺服器端產 PDF
 *
 * 中文 PDF 要**嵌字型**，而一套涵蓋繁簡的字型是好幾 MB——要塞進函式包、要處
 * 理子集化，而換來的排版還不如瀏覽器。瀏覽器本身就是一個排版引擎，而且使用
 * 者的系統裡本來就有中文字型。
 *
 * 所以這裡只做一件事：把資料排成一張乾淨的表，然後請瀏覽器列印。使用者在列
 * 印對話框裡選「另存為 PDF」，拿到的是向量文字的 PDF——可以搜尋、可以複製，
 * 比任何圖片式的輸出都好。
 *
 * ## 為什麼是獨立的一頁
 *
 * 在原本的頁面上按 `window.print()`，印出來是一張**有側邊欄、有下拉選單、有
 * 對話框**的圖。這一頁沒有版面外框（它在 `(studio)` 群組外面自己排），而且
 * 列印樣式把顏色拿掉——深色底印出來是一整頁墨水。
 */
export default async function PrintPage({ params, searchParams }: Params) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { projectId } = await params
  const project = await requireProjectPage(projectId, user.id)
  const sp = await searchParams

  const target = one(sp.target)
  if (!isImportTargetKey(target)) notFound()

  const definition = importTarget(target)
  const episodeId = one(sp.episodeId) ?? null
  const script = one(sp.script)
  const preference = isScriptPreference(script) ? script : 'original'

  const table = await exportRows(target, { projectId: project.id, episodeId })
  const convert = (value: string) =>
    preference === 'original' ? value : convertScript(value, preference)

  return (
    <div className="print-sheet mx-auto max-w-5xl bg-white p-8 text-stage-990">
      <PrintNow />

      <header className="mb-4 border-b border-stage-300 pb-3">
        <h1 className="text-lg font-semibold">
          {convert(project.title)}　{convert(definition.label)}
        </h1>
        <p className="mt-1 text-[11px] text-stage-700">
          {table.rows.length} 筆・
          {new Date().toLocaleDateString('zh-TW', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          })}
        </p>
      </header>

      {table.rows.length === 0 ? (
        <p className="text-sm">沒有資料。</p>
      ) : (
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr>
              {table.headers.map((header) => (
                <th
                  key={header}
                  className="border border-stage-400 bg-stage-200 px-2 py-1 text-left font-medium"
                >
                  {convert(header)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, column) => (
                  <td
                    key={column}
                    className="border border-stage-400 px-2 py-1 align-top whitespace-pre-wrap"
                  >
                    {convert(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
