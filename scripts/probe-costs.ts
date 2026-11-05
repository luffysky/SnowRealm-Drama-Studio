import { loadEnv } from '../src/lib/load-env'
loadEnv()
async function main() {
  const { db } = await import('../src/db')
  const { sql } = await import('drizzle-orm')
  for (const t of ['expenses', 'budgets', 'usage_ledger', 'ai_jobs']) {
    try {
      const r = await db.execute(sql.raw(`select count(*)::int as n from ${t}`))
      console.log(`  ${t.padEnd(14)} ${(r.rows[0] as { n: number }).n} 筆`)
    } catch (e) {
      console.log(`  ${t.padEnd(14)} 查不到：${e instanceof Error ? e.message.split('\n')[0] : e}`)
    }
  }
  const spend = await db.execute(sql.raw(
    `select count(*)::int as n, coalesce(sum(actual_cost),0)::text as total from ai_jobs where actual_cost is not null`
  ))
  console.log(`  AI 已實際花費：${JSON.stringify(spend.rows[0])}`)
  process.exit(0)
}
void main()
