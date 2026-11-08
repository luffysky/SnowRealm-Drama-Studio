import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { filenameGuide } from '../src/lib/import/filename'
import { SHEET_FORMAT_EXTENSION, templateFor, templateGuide } from '../src/lib/import/sheet-format'
import { IMPORT_TARGETS } from '../src/lib/import/targets'

/**
 * 把匯入範本與規格寫成真的檔案 (Z185).
 *
 * 介面上也下載得到同樣的東西（走 `/api/import/template`），而這裡額外把它們
 * 放進 `docs/` 的理由是：**要能直接整個資料夾拖給模型**，不必先開一次網站。
 *
 *     npx tsx scripts/write-import-templates.ts          # 檢查有沒有過期
 *     npx tsx scripts/write-import-templates.ts --write   # 重新產生
 *
 * 沒有 `--write` 的時候只比對，有差就回非零——所以它進得了提交門檻。欄位定義
 * 改了而範本沒重產，是這種「文件從程式產生」的東西最常見的失敗，而那份過期
 * 的範本會讓人照著填完才發現對不上。
 */

const ROOT = 'docs/import'
const write = process.argv.includes('--write')

type Entry = { path: string; content: string }

function build(): Entry[] {
  const entries: Entry[] = [
    { path: join(ROOT, 'README.md'), content: readme() },
    { path: join(ROOT, '檔名規格.md'), content: filenameGuide() },
  ]

  for (const target of IMPORT_TARGETS) {
    entries.push({
      path: join(ROOT, '說明', `${target.label}.md`),
      content: templateGuide(target.key),
    })
    for (const format of ['csv', 'json'] as const) {
      entries.push({
        path: join(ROOT, '範本', `${target.label}.${SHEET_FORMAT_EXTENSION[format]}`),
        content: templateFor(target.key, format),
      })
    }
  }

  return entries
}

function readme(): string {
  return [
    '# 匯入範本',
    '',
    '**這個資料夾是程式產生的。** 要改內容請改 `src/lib/import/targets.ts`，',
    '再跑 `npx tsx scripts/write-import-templates.ts --write`。',
    '',
    '## 怎麼用',
    '',
    '1. 把 `檔名規格.md`、要用的那一份 `說明/<區塊>.md` 與 `範本/<區塊>.csv`',
    '   一起貼給模型。',
    '2. 請它照同樣的欄位產資料，並照檔名規格命名。',
    '3. 回到網站把檔案丟進匯入——可以一次丟很多個，檔名會決定每一個是給哪一區的。',
    '',
    '## 有哪些區塊',
    '',
    ...IMPORT_TARGETS.map(
      (target) => `- **${target.label}**（\`${target.key}\`）：${target.description}`
    ),
    '',
    '## 要緊的幾件事',
    '',
    '- 欄位名稱不用一模一樣，繁簡與英文鍵名都認得。',
    '- 編碼建議 UTF-8；Big5／GBK 也讀得進來，細節在 `檔名規格.md`。',
    '- 匯入前一定會先讓你看對應結果與問題列表，確認了才寫進去。',
    '- **金額不要自己編。**',
    '',
  ].join('\n')
}

function main() {
  const entries = build()

  if (write) {
    rmSync(ROOT, { recursive: true, force: true })
    for (const entry of entries) {
      mkdirSync(join(entry.path, '..'), { recursive: true })
      writeFileSync(entry.path, entry.content, 'utf8')
    }
    console.log(`  寫了 ${entries.length} 個檔案到 ${ROOT}/`)
    process.exit(0)
  }

  const stale: string[] = []
  for (const entry of entries) {
    let current: string | null = null
    try {
      current = readFileSync(entry.path, 'utf8')
    } catch {
      current = null
    }
    // 換行字元在 Windows 上會被 git 轉掉，所以比對前先統一。
    if (current === null || current.replace(/\r\n/g, '\n') !== entry.content) {
      stale.push(entry.path)
    }
  }

  if (stale.length === 0) {
    console.log(`  匯入範本是最新的（${entries.length} 個檔案）`)
    process.exit(0)
  }

  console.log(`\n  ✗ ${stale.length} 個匯入範本過期了：\n`)
  for (const path of stale.slice(0, 10)) console.log(`      ${path}`)
  if (stale.length > 10) console.log(`      …還有 ${stale.length - 10} 個`)
  console.log('\n  重新產生：\n    npx tsx scripts/write-import-templates.ts --write\n')
  process.exit(1)
}

main()
