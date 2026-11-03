/**
 * Export formats, with no database imports — the dialog is a Client Component
 * and `@/lib/novel-export` reaches Drizzle. Same split as `@/lib/music-view`.
 */

export const NOVEL_EXPORT_FORMATS = ['txt', 'epub', 'markdown', 'html'] as const
export type NovelExportFormat = (typeof NOVEL_EXPORT_FORMATS)[number]

export const NOVEL_EXPORT_LABEL: Record<NovelExportFormat, string> = {
  txt: 'TXT 純文字',
  epub: 'EPUB 電子書',
  markdown: 'Markdown',
  html: 'HTML（可列印成 PDF）',
}

export const NOVEL_EXPORT_HINT: Record<NovelExportFormat, string> = {
  txt: '中文小說最通用的格式，手機閱讀 App 幾乎都吃。附 BOM，避免 Windows 猜成 GBK 變亂碼。',
  epub: '電子書標準。Apple Books、Kobo、Google Play 圖書可直接讀；Kindle 用「Send to Kindle」寄進去會自動轉檔。',
  markdown: '純文字加標題階層，適合再拿去編輯或丟進版本庫。',
  html: '單一檔案、排版好、可直接列印成 PDF。這裡不做 PDF 匯出——中文 PDF 要內嵌好幾 MB 的字型，瀏覽器本來就有字型，印出來的結果更好。',
}
