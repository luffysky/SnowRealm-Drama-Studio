import { importTarget, type ImportTargetKey } from '@/lib/import/targets'

/**
 * 從欄位定義產生範例文檔，以及把資料寫成檔案 (Z185).
 *
 * **匯入、匯出與範本是同一份欄位定義算出來的**（`targets.ts`）。分開維護的
 * 話，範本會先過期——而一份過期的範本比沒有範本糟，因為人會照著它填，然後匯
 * 入告訴他每一欄都對不上。
 */

export type SheetFormat = 'csv' | 'tsv' | 'json' | 'markdown'

export const SHEET_FORMAT_LABEL: Record<SheetFormat, string> = {
  csv: 'CSV',
  tsv: 'TSV（貼進試算表）',
  json: 'JSON',
  markdown: 'Markdown 表格',
}

export const SHEET_FORMAT_EXTENSION: Record<SheetFormat, string> = {
  csv: 'csv',
  tsv: 'tsv',
  json: 'json',
  markdown: 'md',
}

export const SHEET_FORMAT_MIME: Record<SheetFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  json: 'application/json; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
}

/* -------------------------------------------------------------------------- */

/**
 * 給模型看的範本。
 *
 * JSON 版附一段 `_說明`，裡面逐欄寫清楚每個鍵要填什麼——這正是「我給 GPT 寫
 * 好相應欄位跟內容」那個用法要的東西。其他格式把說明寫在檔案開頭的註解行，
 * 而**那幾行以 `#` 開頭**，匯入時會被當成資料列讀進來⋯⋯所以不這樣做：說明
 * 另外放在同一次下載的 `-說明.md` 裡，範本檔本身只有標題列加一列示範值。
 */
export function templateFor(key: ImportTargetKey, format: SheetFormat): string {
  const target = importTarget(key)

  if (format === 'json') {
    return JSON.stringify(
      {
        _說明: `${target.label}：${target.description}`,
        _每一欄要填什麼: Object.fromEntries(
          target.fields.map((field) => [
            field.label,
            [field.note, field.required ? '（必填）' : ''].filter(Boolean).join(' ') || '自由填寫',
          ])
        ),
        rows: [Object.fromEntries(target.fields.map((field) => [field.label, field.sample]))],
      },
      null,
      2
    )
  }

  const headers = target.fields.map((field) => field.label)
  const sample = target.fields.map((field) => field.sample)
  return writeSheet(headers, [sample], format)
}

/** 範本旁邊那份說明，給人看也給模型看。 */
export function templateGuide(key: ImportTargetKey): string {
  const target = importTarget(key)
  const lines: string[] = [
    `# ${target.label}　匯入範本說明`,
    '',
    target.description,
    '',
    '## 怎麼用',
    '',
    '1. 把這份說明連同範本一起貼給模型，請它照同樣的欄位產資料。',
    '2. 拿到結果之後回到這個頁面匯入——JSON、CSV、TSV、Markdown 表格、HTML 表格、',
    '   Excel 檔都收，直接從試算表複製貼上也可以。',
    '3. 匯入前會先讓你看對應到哪一欄、哪幾列有問題，確認了才寫進去。',
    '',
    '## 欄位',
    '',
    '| 欄位 | 必填 | 說明 | 範例 |',
    '|---|---|---|---|',
  ]

  for (const field of target.fields) {
    const note = field.note ?? describeType(field.type)
    lines.push(
      `| ${field.label} | ${field.required ? '是' : ''} | ${escapePipes(note)} | ${escapePipes(field.sample)} |`
    )
  }

  lines.push(
    '',
    '## 幾件要緊的事',
    '',
    '- **欄位名稱不用一模一樣。** 繁簡、英文鍵名、帶括號的補充說明都認得；認不出來的',
    '  那一欄會讓你自己選。',
    '- 沒有的欄位可以整欄不要，留空就是留空。',
    '- 金額只填數字，幣別分一欄——**金額不要自己編**。',
    '- 多出來、不認得的欄位會被忽略，不會亂塞。',
    ''
  )
  return lines.join('\n')
}

function describeType(type: string): string {
  switch (type) {
    case 'int':
      return '整數'
    case 'decimal':
      return '數字，可以有小數'
    case 'date':
      return 'YYYY-MM-DD'
    case 'tags':
      return '用頓號或逗號隔開'
    case 'longText':
      return '長文字，可以換行'
    default:
      return '文字'
  }
}

/* -------------------------------------------------------------------------- */

/** 標題列加資料列 → 檔案內容。 */
export function writeSheet(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  format: SheetFormat
): string {
  if (format === 'json') {
    return JSON.stringify(
      rows.map((row) => Object.fromEntries(headers.map((head, i) => [head, row[i] ?? '']))),
      null,
      2
    )
  }

  if (format === 'markdown') {
    const line = (cells: readonly string[]) =>
      `| ${cells.map((cell) => escapePipes(cell.replace(/\n/g, '<br>'))).join(' | ')} |`
    return [
      line(headers),
      `| ${headers.map(() => '---').join(' | ')} |`,
      ...rows.map(line),
    ].join('\n')
  }

  const delimiter = format === 'tsv' ? '\t' : ','
  const cell = (value: string) => {
    if (format === 'tsv') {
      // TSV 沒有引號規則，所以把 tab 與換行換掉——不然貼回試算表會錯位。
      return value.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
    }
    return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
  }

  return [headers, ...rows].map((row) => row.map(cell).join(delimiter)).join('\n')
}

function escapePipes(text: string): string {
  return text.replace(/\|/g, '\\|')
}

/* -------------------------------------------------------------------------- */
