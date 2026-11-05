import { loadEnv } from '../src/lib/load-env'
loadEnv()
async function main() {
  const { db } = await import('../src/db')
  const { sql } = await import('drizzle-orm')
  for (const t of ['tasks', 'subtasks', 'task_comments']) {
    const r = await db.execute(sql.raw(`select count(*)::int as n from ${t}`))
    console.log(`  ${t.padEnd(14)} ${(r.rows[0] as {n:number}).n} 筆`)
  }
  const s = await db.execute(sql.raw(`
    select status, priority, count(*)::int as n from tasks where deleted_at is null
     group by status, priority order by count(*) desc limit 8`))
  for (const x of s.rows as Record<string, unknown>[]) console.log(`    ${x.status} / ${x.priority}  ${x.n}`)
  process.exit(0)
}
void main()
