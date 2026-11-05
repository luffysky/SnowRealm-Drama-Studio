import { loadEnv } from '../src/lib/load-env'
loadEnv()

/** 同一部作品裡有沒有重複的集號——資料庫沒有擋這件事。 */
async function main() {
  const { db } = await import('../src/db')
  const { sql } = await import('drizzle-orm')

  const dupes = await db.execute(sql`
    select p.title as project, e.number, count(*) as n,
           string_agg(a.title, ' / ') as arcs
      from episodes e
      join projects p on p.id = e.project_id
      join arcs a on a.id = e.arc_id
     where e.deleted_at is null
     group by p.title, e.number
    having count(*) > 1
     order by count(*) desc
     limit 20
  `)

  const rows = dupes.rows as Record<string, unknown>[]
  console.log(`  重複的集號：${rows.length} 組`)
  for (const row of rows) {
    console.log(`    《${row.project}》 第 ${row.number} 集 × ${row.n}  （${row.arcs}）`)
  }

  const totals = await db.execute(sql`
    select p.title as project, count(*) as episodes, count(distinct e.arc_id) as arcs
      from episodes e join projects p on p.id = e.project_id
     where e.deleted_at is null group by p.title order by count(*) desc
  `)
  console.log('\n  現況：')
  for (const row of totals.rows as Record<string, unknown>[]) {
    console.log(`    《${row.project}》 ${row.episodes} 集，${row.arcs} 卷`)
  }

  process.exit(0)
}

void main()
