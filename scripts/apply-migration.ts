import { readFileSync } from 'node:fs'
import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * Applies one migration file to Neon and the test database. Idempotent ones only.
 *
 * `--test-only` 只套本機那一座。分開是因為**套到 Neon 是上線動作**，而寫
 * migration 的過程需要在本機跑好幾次；兩件事綁在同一個指令裡，等於每試一次就
 * 碰一次正式資料庫。
 */
async function main() {
  const args = process.argv.slice(2)
  const testOnly = args.includes('--test-only')
  const file = args.find((arg) => !arg.startsWith('--'))
  if (!file) {
    throw new Error('用法：npx tsx scripts/apply-migration.ts [--test-only] drizzle/00XX_name.sql')
  }

  const { Client } = await import('pg')
  const sql = readFileSync(file, 'utf8')

  const targets: [string, string | undefined][] = testOnly
    ? [['測試庫', process.env.TEST_DATABASE_URL]]
    : [
        ['Neon', process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL],
        ['測試庫', process.env.TEST_DATABASE_URL],
      ]

  for (const [label, url] of targets) {
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
