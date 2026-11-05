import { loadEnv } from '../src/lib/load-env'
loadEnv()

/** 帳面上的原始數字，對照成本中心算出來的。 */
async function main() {
  const { db } = await import('../src/db')
  const { sql } = await import('drizzle-orm')
  const { costOverview } = await import('../src/lib/costs')
  const { getFxRates } = await import('../src/lib/settings')

  const raw = await db.execute(sql.raw(`
    select kind, currency, count(*)::int as n, sum(amount)::text as total
      from usage_ledger group by kind, currency order by kind, currency
  `))
  console.log('  用量帳原始：')
  for (const r of raw.rows as Record<string, unknown>[]) {
    console.log(`    ${r.kind} ${r.currency}  ${r.n} 筆  ${r.total}`)
  }

  const settled = await db.execute(sql.raw(`
    select count(*)::int as n from usage_ledger where kind='ESTIMATE'
      and id in (select settles_id from usage_ledger where settles_id is not null)
  `))
  console.log(`  被結算掉的估算：${(settled.rows[0] as {n:number}).n} 筆`)

  const exp = await db.execute(sql.raw(`
    select currency, count(*)::int as n, sum(amount)::text as total
      from expenses group by currency
  `))
  console.log('  手動支出原始：')
  for (const r of exp.rows as Record<string, unknown>[]) {
    console.log(`    ${r.currency}  ${r.n} 筆  ${r.total}`)
  }

  const fx = await getFxRates()
  console.log(`\n  匯率 base=${fx.base} rates=${JSON.stringify(fx.rates)}`)

  for (const currency of ['USD', 'TWD', 'CNY'] as const) {
    const o = await costOverview({ currency, fx })
    console.log(
      `  以 ${currency} 顯示：實際 ${o.totals.actual.toFixed(4)}  承諾 ${o.totals.committed.toFixed(4)}  手動 ${o.totals.manual.toFixed(4)}`
    )
  }

  process.exit(0)
}

void main()
