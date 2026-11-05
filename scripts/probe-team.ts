import { loadEnv } from '../src/lib/load-env'
loadEnv()
async function main() {
  const { db } = await import('../src/db')
  const { sql } = await import('drizzle-orm')
  const r = await db.execute(sql.raw(`
    select coalesce(user_name,'(無)') as who, count(*)::int as n,
           max(created_at)::text as last
      from activities group by user_name order by count(*) desc limit 10
  `))
  for (const row of r.rows as Record<string, unknown>[]) {
    console.log(`  ${String(row.who).padEnd(10)} ${String(row.n).padStart(4)} 筆  最後 ${String(row.last).slice(0,16)}`)
  }
  const kinds = await db.execute(sql.raw(`
    select action, count(*)::int as n from activities group by action order by count(*) desc limit 8
  `))
  console.log('  動作種類：')
  for (const row of kinds.rows as Record<string, unknown>[]) {
    console.log(`    ${String(row.action).padEnd(14)} ${row.n}`)
  }
  process.exit(0)
}
void main()
