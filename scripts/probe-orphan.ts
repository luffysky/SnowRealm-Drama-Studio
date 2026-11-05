import { loadEnv } from '../src/lib/load-env'
loadEnv()
async function main() {
  const { db } = await import('../src/db')
  const { sql } = await import('drizzle-orm')
  const r = await db.execute(sql.raw(`
    select u.name as now_called, u.email, a.user_name as recorded_as, count(*)::int as n
      from activities a join users u on u.id = a.user_id
     group by u.name, u.email, a.user_name order by u.email, count(*) desc
  `))
  for (const x of r.rows as Record<string, unknown>[]) {
    console.log(`  現在叫 ${String(x.now_called).padEnd(8)} (${x.email})  當時記成「${x.recorded_as}」 ${x.n} 筆`)
  }
  process.exit(0)
}
void main()
