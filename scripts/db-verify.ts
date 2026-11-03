/**
 * Does the database actually match the Drizzle schema?
 *
 *   npx tsx scripts/db-verify.ts                    # whatever DATABASE_URL points at
 *   npx tsx scripts/db-verify.ts --url <postgres://…>
 *
 * `db-check.ts` prints what exists. This one *compares*, which is the part
 * that matters after a hand-written migration: several of ours were written by
 * hand because drizzle-kit's generator needs a TTY for rename prompts, and a
 * hand-written migration is exactly where a column ends up spelled
 * `parent_ref_id` in SQL and `parentRefId` in the schema with nothing to catch
 * it until a query returns undefined at runtime.
 *
 * Checks, per table: missing tables, missing columns, columns the schema does
 * not know about, nullability, and enum membership. Exits non-zero on any
 * mismatch so it can gate a deploy.
 *
 * Extra columns are reported but do not fail: a column the schema stopped
 * using is harmless until someone drops it, and dropping it is a decision.
 */
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { Client } from 'pg'
import * as schema from '../src/db/schema'
import { loadEnv } from '../src/lib/load-env'

type Actual = {
  name: string
  nullable: boolean
  dataType: string
  udtName: string
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? null : (process.argv[index + 1] ?? null)
}

function isPgTable(value: unknown): value is PgTable {
  if (!value || typeof value !== 'object') return false
  try {
    getTableConfig(value as PgTable)
    return true
  } catch {
    return false
  }
}

async function main() {
  loadEnv()

  const url = arg('url') || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
  if (!url) throw new Error('需要 --url 或 DATABASE_URL')

  const client = new Client({ connectionString: url })
  await client.connect()

  const host = new URL(url.replace(/^postgres(ql)?:\/\//, 'http://')).host
  console.log(`\n比對 ${host}\n`)

  const { rows: columnRows } = await client.query<{
    table_name: string
    column_name: string
    is_nullable: string
    data_type: string
    udt_name: string
  }>(
    `select table_name, column_name, is_nullable, data_type, udt_name
       from information_schema.columns
      where table_schema = 'public'`
  )

  const actual = new Map<string, Map<string, Actual>>()
  for (const row of columnRows) {
    const table = actual.get(row.table_name) ?? new Map<string, Actual>()
    table.set(row.column_name, {
      name: row.column_name,
      nullable: row.is_nullable === 'YES',
      dataType: row.data_type,
      udtName: row.udt_name,
    })
    actual.set(row.table_name, table)
  }

  const { rows: enumRows } = await client.query<{ typname: string; label: string }>(
    `select t.typname, e.enumlabel as label
       from pg_type t
       join pg_enum e on e.enumtypid = t.oid
      order by t.typname, e.enumsortorder`
  )

  const actualEnums = new Map<string, string[]>()
  for (const row of enumRows) {
    actualEnums.set(row.typname, [...(actualEnums.get(row.typname) ?? []), row.label])
  }

  let problems = 0
  let checkedTables = 0
  let checkedColumns = 0

  for (const value of Object.values(schema)) {
    if (!isPgTable(value)) continue

    const config = getTableConfig(value as PgTable)
    const tableName = config.name
    checkedTables += 1

    const columns = actual.get(tableName)
    if (!columns) {
      console.log(`  ✗ 資料表不存在：${tableName}`)
      problems += 1
      continue
    }

    const expectedNames = new Set<string>()

    for (const column of config.columns) {
      const columnName = column.name
      expectedNames.add(columnName)
      checkedColumns += 1

      const found = columns.get(columnName)
      if (!found) {
        console.log(`  ✗ ${tableName}.${columnName} 不存在於資料庫`)
        problems += 1
        continue
      }

      /*
       * Nullability only. Comparing types properly would mean mapping every
       * Drizzle builder to its Postgres spelling, and a wrong mapping here
       * would cry wolf on every run until people stopped reading the output.
       */
      const expectedNullable = !column.notNull
      if (expectedNullable !== found.nullable) {
        console.log(
          `  ✗ ${tableName}.${columnName} 可否為 NULL 不一致：` +
            `schema=${expectedNullable ? 'NULL' : 'NOT NULL'} / ` +
            `db=${found.nullable ? 'NULL' : 'NOT NULL'}`
        )
        problems += 1
      }
    }

    for (const columnName of columns.keys()) {
      if (!expectedNames.has(columnName)) {
        console.log(`  · ${tableName}.${columnName} 資料庫有，但 schema 沒有（不視為錯誤）`)
      }
    }
  }

  /* ------------------------------------------------------------- enums -- */

  for (const value of Object.values(schema)) {
    const candidate = value as { enumName?: string; enumValues?: readonly string[] }
    if (!candidate?.enumName || !Array.isArray(candidate.enumValues)) continue

    const inDb = actualEnums.get(candidate.enumName)
    if (!inDb) {
      console.log(`  ✗ enum 型別不存在：${candidate.enumName}`)
      problems += 1
      continue
    }

    for (const label of candidate.enumValues) {
      if (!inDb.includes(label)) {
        console.log(`  ✗ enum ${candidate.enumName} 缺少值：${label}`)
        problems += 1
      }
    }

    for (const label of inDb) {
      if (!candidate.enumValues.includes(label)) {
        console.log(`  · enum ${candidate.enumName} 資料庫多了值：${label}（不視為錯誤）`)
      }
    }
  }

  /* -------------------------------------------------------- foreign keys -- */

  /*
   * Every `*_id` column with no foreign key behind it. Some are deliberate —
   * a derived index should not be able to block a delete on its source — so
   * this is a list to read, not a failure. What it catches is the accidental
   * one: a reference added in a hurry that lets a row point at something that
   * no longer exists.
   */
  const { rows: fkRows } = await client.query<{ table_name: string; column_name: string }>(
    `select tc.table_name, kcu.column_name
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on kcu.constraint_name = tc.constraint_name
        and kcu.table_schema = tc.table_schema
      where tc.table_schema = 'public' and tc.constraint_type = 'FOREIGN KEY'`
  )

  const hasForeignKey = new Set(fkRows.map((row) => `${row.table_name}.${row.column_name}`))

  const danglingRefs: string[] = []
  for (const [tableName, columns] of actual) {
    for (const [columnName, column] of columns) {
      if (!columnName.endsWith('_id') || columnName === 'id') continue
      // Only uuid columns reference a row. `multipart_upload_id` is R2's
      // handle and `voice_id` is a provider's voice name — both are text.
      if (column.udtName !== 'uuid') continue
      if (hasForeignKey.has(`${tableName}.${columnName}`)) continue
      danglingRefs.push(`${tableName}.${columnName}`)
    }
  }

  if (danglingRefs.length > 0) {
    console.log(`\n沒有外鍵的參照欄位（${danglingRefs.length}，部分是刻意的）：`)
    for (const ref of danglingRefs) console.log(`  · ${ref}`)
  }

  await client.end()

  console.log(
    `\n檢查了 ${checkedTables} 張資料表、${checkedColumns} 個欄位、` +
      `${actualEnums.size} 個 enum 型別、${hasForeignKey.size} 個外鍵`
  )

  if (problems > 0) {
    console.log(`\n✗ ${problems} 處不一致\n`)
    process.exit(1)
  }

  console.log('\n✓ schema 與資料庫一致\n')
  process.exit(0)
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
