import { loadEnv } from '../src/lib/load-env'
loadEnv()

/** 哪些音檔有波形資料，哪些沒有。 */
async function main() {
  const { db } = await import('../src/db')
  const { sql } = await import('drizzle-orm')

  const rows = await db.execute(sql`
    select a.kind,
           count(*) as total,
           count(v.id) as with_wave,
           count(*) filter (where a.duration_sec is null) as no_duration
      from assets a
      left join asset_variants v
        on v.asset_id = a.id and v.kind = 'WAVEFORM'
     where a.deleted_at is null
       and a.kind in ('MUSIC', 'SFX', 'VOICE')
     group by a.kind
     order by a.kind
  `)

  console.log('  素材種類        共計  有波形  沒長度')
  for (const row of rows.rows as Record<string, unknown>[]) {
    console.log(
      `  ${String(row.kind).padEnd(14)} ${String(row.total).padStart(4)}  ${String(row.with_wave).padStart(6)}  ${String(row.no_duration).padStart(6)}`
    )
  }

  const named = await db.execute(sql`
    select a.kind, a.title, a.duration_sec,
           (v.id is not null) as has_wave,
           a.mime_type
      from assets a
      left join asset_variants v
        on v.asset_id = a.id and v.kind = 'WAVEFORM'
     where a.deleted_at is null
       and a.kind in ('MUSIC', 'SFX', 'VOICE')
     order by a.created_at desc
     limit 20
  `)

  console.log('\n  最近 20 筆：')
  for (const row of named.rows as Record<string, unknown>[]) {
    console.log(
      `  ${row.has_wave ? '✓' : '✗'} ${String(row.kind).padEnd(6)} ${String(row.mime_type ?? "").padEnd(10)} ${String(row.title).slice(0, 40)}`
    )
  }

  process.exit(0)
}

void main()
