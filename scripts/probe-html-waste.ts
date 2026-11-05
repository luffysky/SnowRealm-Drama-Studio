import { loadEnv } from '../src/lib/load-env'
loadEnv()

/** 送去給模型的正文裡，有多少是標籤。 */
async function main() {
  const { db } = await import('../src/db')
  const { chapters } = await import('../src/db/schema')
  const { stripHtmlToText } = await import('../src/lib/utils')

  const rows = await db
    .select({ title: chapters.title, content: chapters.content })
    .from(chapters)

  let rawTotal = 0
  let textTotal = 0

  for (const row of rows) {
    const raw = row.content ?? ''
    const text = stripHtmlToText(raw)
    rawTotal += raw.length
    textTotal += text.length
  }

  const waste = rawTotal - textTotal
  const pct = rawTotal > 0 ? (waste / rawTotal) * 100 : 0

  console.log(`  ${rows.length} 章`)
  console.log(`  原始 HTML   ${rawTotal.toLocaleString()} 字元`)
  console.log(`  純文字      ${textTotal.toLocaleString()} 字元`)
  console.log(`  標籤        ${waste.toLocaleString()} 字元  （${pct.toFixed(1)}%）`)

  // 一次全書審稿，多付多少。Claude 的中文大約 1 字元 ≈ 1 token 上下。
  const perMillionIn = 5
  console.log(`\n  若整本送審一次，光標籤約多付 $${((waste / 1_000_000) * perMillionIn).toFixed(4)}`)
  console.log(`  以 120 集推估（目前 ${rows.length} 章）：約多付 $${(((waste / rows.length) * 120 / 1_000_000) * perMillionIn).toFixed(4)} / 次`)

  process.exit(0)
}

void main()
