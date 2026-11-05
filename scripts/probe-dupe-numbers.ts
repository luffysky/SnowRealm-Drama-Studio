import { loadEnv } from '../src/lib/load-env'
loadEnv()

/** 兩個資料庫都要查——索引建不起來的原因只會是「已經有重複了」。 */
async function main() {
  const { Client } = await import('pg')

  for (const [label, url] of [
    ['Neon', process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL],
    ['測試庫', process.env.TEST_DATABASE_URL],
  ] as [string, string | undefined][]) {
    if (!url) {
      console.log(`  ${label}: 沒有連線字串，跳過`)
      continue
    }

    const client = new Client({ connectionString: url })
    await client.connect()

    const { rows } = await client.query(`
      select project_id, number, count(*) as n
        from episodes
       where deleted_at is null
       group by project_id, number
      having count(*) > 1
       limit 10
    `)

    const total = await client.query(`select count(*)::int as n from episodes where deleted_at is null`)

    console.log(`  ${label}: ${total.rows[0].n} 集，重複集號 ${rows.length} 組 ${rows.length === 0 ? '✓ 可以建索引' : '✗ 建不起來'}`)
    for (const row of rows) console.log(`      project=${row.project_id} number=${row.number} ×${row.n}`)

    await client.end()
  }

  process.exit(0)
}

void main()
