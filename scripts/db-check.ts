/**
 * Prints what actually exists in the connected database: tables with row
 * counts, enum types, and index count. Useful after a migration, and as the
 * quickest way to confirm a new Neon branch is wired up correctly.
 *
 *   npx tsx scripts/db-check.ts
 */
import { Client } from 'pg'
import { loadEnv } from '../src/lib/load-env'

async function main() {
  loadEnv()

  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL_UNPOOLED or DATABASE_URL is required')

  const client = new Client({ connectionString: url })
  await client.connect()

  const host = new URL(url.replace(/^postgres(ql)?:\/\//, 'http://')).host
  console.log(`\nconnected to ${host}\n`)

  const { rows: tables } = await client.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`
  )

  console.log(`tables (${tables.length}):`)
  for (const { tablename } of tables) {
    const { rows } = await client.query<{ n: string }>(
      `select count(*)::text as n from "${tablename}"`
    )
    console.log(`  ${tablename.padEnd(26)} ${(rows[0]?.n ?? '?').padStart(6)} rows`)
  }

  const { rows: enums } = await client.query<{ typname: string; values: string }>(
    `select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) as values
       from pg_type t
       join pg_enum e on e.enumtypid = t.oid
      group by t.typname
      order by t.typname`
  )
  console.log(`\nenums (${enums.length}):`)
  for (const e of enums) {
    console.log(`  ${e.typname.padEnd(20)} ${e.values}`)
  }

  const { rows: idx } = await client.query<{ n: string }>(
    `select count(*)::text as n from pg_indexes where schemaname = 'public'`
  )
  console.log(`\nindexes: ${idx[0]?.n ?? '?'}\n`)

  await client.end()
}

main().catch((err) => {
  console.error('[db-check] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
