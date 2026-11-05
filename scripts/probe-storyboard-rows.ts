import { sql } from 'drizzle-orm'
import { loadEnv } from '../src/lib/load-env'

loadEnv()

/**
 * 分鏡與審核這兩塊，資料表裡到底有沒有東西 (Z39/Z41).
 *
 * 這決定「做一個檢視」跟「做出功能」的差別——Z89 那次就是因為 `tasks` 一筆
 * 都沒有，所以不是做一個看板，是做出任務功能。先問清楚再動手。
 */
async function main() {
  const { db } = await import('../src/db')

  const tables = [
    'shots',
    'scenes',
    'reviews',
    'approval_records',
    'versions',
    'episodes',
    'documents',
  ]

  for (const table of tables) {
    const result = await db.execute(sql.raw(`select count(*)::int as n from ${table}`))
    const rows = (result as unknown as { rows?: { n: number }[] }).rows ?? []
    console.log(`  ${table.padEnd(20)} ${rows[0]?.n ?? '?'}`)
  }

  // 劇本有幾集寫了：分鏡是從劇本來的，沒有劇本就沒有分鏡可以生成。
  const scripts = await db.execute(
    sql.raw(`select count(*)::int as n from documents where kind = 'SCRIPT' and deleted_at is null`)
  )
  const scriptRows = (scripts as unknown as { rows?: { n: number }[] }).rows ?? []
  console.log(`\n  劇本文件（SCRIPT）     ${scriptRows[0]?.n ?? '?'}`)
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  }
)
