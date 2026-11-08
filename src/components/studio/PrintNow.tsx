'use client'

import { Printer } from 'lucide-react'

/**
 * 列印那一頁上面的按鈕 (Z187).
 *
 * **不自動跳列印對話框。** 自動跳的版本看起來比較貼心，而它有兩個問題：資料
 * 還在載的時候跳出來，印到的是半張表；而且使用者按了取消之後，就只剩一個不
 * 知道怎麼再叫出來的畫面。
 *
 * 這顆按鈕自己在列印時會消失（`print:hidden`），所以它不會出現在 PDF 裡。
 */
export function PrintNow() {
  return (
    <div className="mb-4 flex items-center gap-2 print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-stage-900 px-3 py-1.5 text-[11px] text-ink-100 transition-opacity hover:opacity-90"
      >
        <Printer aria-hidden className="size-3.5" />
        列印／另存 PDF
      </button>
      <p className="text-[10px] text-stage-600">
        在列印對話框裡選「另存為 PDF」。出來的是向量文字，可以搜尋也可以複製。
      </p>
    </div>
  )
}
