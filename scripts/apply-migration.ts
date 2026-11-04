import { readFileSync } from 'node:fs'
import { loadEnv } from '../src/lib/load-env'
loadEnv()

/** Applies one migration file to Neon and the test database. Idempotent ones only. */
async function main() {
  const file = process.argv[2]
  if (!file) throw new Error('用法：npx tsx scripts/apply-migration.ts drizzle/00XX_name.sql')

  const { Client } = await import('pg')
  const sql = readFileSync(file, 'utf8')

  for (const [label, url] of [
    ['Neon', process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL],
    ['測試庫', process.env.TEST_DATABASE_URL],
  ] as [string, string | undefined][]) {
    if (!url) { console.log(`  ${label}: 沒有連線字串，跳過`); continue }
    const client = new Client({ connectionString: url })
    await client.connect()
    await client.query(sql)
    console.log(`  ${label}: 套用完成`)
    await client.end()
  }
  process.exit(0)
}
void main()
