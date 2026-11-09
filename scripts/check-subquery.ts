/**
 * 關聯子查詢裡不可以用 ${} 內插外層的欄位（Z199）。
 *
 *     npx tsx scripts/check-subquery.ts
 *
 * ## 這一條在擋什麼
 *
 * drizzle 渲染內插進 `sql` 模板的欄位物件時，**加不加表名要看上下文**：
 *
 *     // 單表 select（沒有 join）──不帶表名
 *     select "id", (select count(*) from shots s where s.episode_id = "id") from "episodes"
 *
 *     // where 子句裡──有帶
 *     ... where exists (select 1 from stages s where s.episode_id = "episodes"."id")
 *
 *     // select 但有 join──有帶
 *     select "assets"."id", exists (... where v.asset_id = "assets"."id") from "assets" inner join ...
 *
 * 第一種會出事：子查詢裡那個光禿禿的 `"id"` 會綁到最內層的 `shots s`——它也有
 * `id` 欄。條件變成 `s.episode_id = s.id`，**永遠不成立**。
 *
 * Postgres 不報錯。它只是回 0。
 *
 * ## 實際出過的事
 *
 * 分鏡工作台的集數下拉對每一集都寫「0 鏡」，而那一集有三十個鏡頭（`shotCount`、
 * `totalSec`、`approved`、`hasScript` 四欄一起壞）；大綱頁的每集字數一律是 0，
 * 而二十集裡有正文。兩個地方、五個欄位。
 *
 * ## 為什麼整個形狀都擋，不是只擋會出事的那一種
 *
 * 安不安全取決於**那一刻有沒有 join**，而 join 是會被改的。今天安全的寫法，
 * 明天有人把一個 `leftJoin` 拿掉就靜靜地壞掉，而症狀是一個 0——跟「真的沒有
 * 資料」長得一模一樣。寫死限定名在三種情況下都對，所以就一律寫死。
 *
 * 專案裡本來就有三處是這樣寫的（`asset-center.ts`、`assets.ts`、
 * `music-library.ts`），而那三處從來沒出過問題。
 *
 * ## 為什麼是靜態掃描
 *
 * 型別檢查不管（兩種寫法都合法）、lint 不管、測試只有在剛好有那張表的資料時
 * 才抓得到。而這個錯的症狀是「數字是 0」。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'src'
const SKIP = new Set(['node_modules', '.next', '.git'])

/** `sql<…>\`…\`` 或 `sql\`…\``。非貪婪，到第一個反引號為止。 */
const TEMPLATE = /sql(?:<[^>]*>)?`([\s\S]*?)`/g
/** 子查詢的特徵：模板裡自己有一個 `from`。 */
const HAS_FROM = /\bfrom\s+[`$\w"]/

/**
 * 被比對的那一側才算。
 *
 * `where x.foo_id = ${t.id}` 是問題；`from unnest(${t.tags}) tag` 不是——後者
 * 是在指定子查詢的來源，而 `unnest()` 產生的別名沒有同名欄位可以遮蔽它。只抓
 * 比較運算子右邊的，`世界觀`／`作品` 那兩處標籤搜尋才不會被誤報成錯。
 */
const COMPARED_REF = /(?:=|<>|!=|<=|>=|<|>|\bin\s*\()\s*\$\{(\w+)\.(\w+)\}/g

/**
 * 這個檔案從 schema import 了哪些名字。
 *
 * 只有它們才是 drizzle 的表物件。`${query.stage}`、`${input.id}` 那種是在傳
 * **值**，渲染成參數佔位符，完全正常——不先問清楚哪些是表，這支工具會把半個
 * 專案標成錯的，然後沒有人會理它。
 */
function schemaNames(text: string): Set<string> {
  const names = new Set<string>()
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@\/db\/schema'/g)) {
    for (const raw of (match[1] ?? '').split(',')) {
      const name = raw.replace(/\btype\b/, '').trim().split(/\s+as\s+/).pop()?.trim()
      if (name) names.add(name)
    }
  }
  return names
}

export type Hit = { file: string; line: number; refs: string[]; snippet: string }

export function scanText(file: string, text: string): Hit[] {
  const tables = schemaNames(text)
  if (tables.size === 0) return []

  const hits: Hit[] = []
  for (const match of text.matchAll(TEMPLATE)) {
    const body = match[1] ?? ''
    if (!HAS_FROM.test(body)) continue

    const refs = [...body.matchAll(COMPARED_REF)]
      .filter((m) => tables.has(m[1] ?? ''))
      .map((m) => `${m[1]}.${m[2]}`)
    if (refs.length === 0) continue

    hits.push({
      file,
      line: text.slice(0, match.index).split('\n').length,
      refs: [...new Set(refs)],
      snippet: body
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' ')
        .slice(0, 100),
    })
  }
  return hits
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) yield full
  }
}

/**
 * 這支工具自己會不會壞。
 *
 * 餵它一段**真的壞掉過**的程式碼（`storyboardIndex` 的原文），抓不到就直接說
 * 工具壞了，不要報平安。順便餵一段正確的寫法，確認它不會誤報——不然大家會為了
 * 讓它閉嘴而把對的程式碼也改掉。
 */
function selfTest(): boolean {
  const imports = "import { assets, chapters, documents, episodes, projects, shots } from '@/db/schema'\n"

  const bad = [
    // 真的壞過的那一行（`storyboardIndex`）。
    'sql<number>`(\n  select count(*) from shots s where s.episode_id = ${episodes.id}\n)`',
    // 集數列表的階段篩選，同一個病。
    'sql`exists (select 1 from ${episodeProductionStages} s where s.episode_id = ${episodes.id})`',
  ]
  for (const sample of bad) {
    if (scanText('x.ts', imports + sample).length !== 1) {
      console.log(`  ✗ 這支工具壞了：抓不到已知的壞寫法 ${sample.slice(0, 50)}`)
      return false
    }
  }

  const good = [
    // 寫死限定名——正確。
    'sql<boolean>`exists (select 1 from asset_variants v where v.asset_id = assets.id)`',
    // 沒有子查詢，內插參數值是正常的。
    'sql`${episodes.number} = ${wanted}`',
    // 內插表名而不是欄位，也是正常的。
    'sql<number>`(select count(*) from ${chapters} where ${chapters}.document_id = documents.id)`',
    // `unnest()` 的參數不是被比對的那一側——標籤搜尋就是這樣寫的。
    'sql`exists (select 1 from unnest(${projects.tags}) tag where tag ilike ${like})`',
    // 傳值，不是傳欄位物件。
    'sql`exists (select 1 from stages s where s.stage_key = ${query.stage})`',
  ]
  for (const sample of good) {
    if (scanText('x.ts', imports + sample).length !== 0) {
      console.log(`  ✗ 這支工具壞了：誤報了正確的寫法 ${sample.slice(0, 60)}`)
      return false
    }
  }
  return true
}

if (!selfTest()) process.exit(1)

const hits: Hit[] = []
for (const file of walk(ROOT)) {
  hits.push(...scanText(file, readFileSync(file, 'utf8')))
}

if (hits.length === 0) {
  console.log('  ✓ 關聯子查詢都沒有內插外層欄位（自我檢查通過）')
  process.exit(0)
}

console.log(`  ✗ ${hits.length} 處在子查詢裡內插了外層欄位：\n`)
for (const hit of hits) {
  console.log(`      ${hit.file}:${hit.line}  ${hit.refs.join('、')}`)
  console.log(`        ${hit.snippet}`)
  console.log(`        改成寫死限定名，例如把 \${${hit.refs[0]}} 換成 ${hit.refs[0]}\n`)
}
process.exit(1)
