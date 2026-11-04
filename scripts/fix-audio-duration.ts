import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * 把已經存在的有聲書長度補正。
 *
 * 它們存的是合成前的估算（字數 ÷ 每秒 3.9 字），短了約 9%——播放器說
 * 15:01，素材庫寫 13 分 42 秒。改成照實際位元組算，跟播放器一致。
 *
 * 只改 `duration_sec`，不動檔案也不動其他欄位。
 */
async function main() {
  const { db } = await import('../src/db')
  const { assets } = await import('../src/db/schema')
  const { and, eq, isNull } = await import('drizzle-orm')
  const { durationFromBytes } = await import('../src/lib/azure/speech')

  const rows = await db
    .select({
      id: assets.id,
      title: assets.title,
      sizeBytes: assets.sizeBytes,
      durationSec: assets.durationSec,
    })
    .from(assets)
    .where(
      and(eq(assets.kind, 'VOICE'), eq(assets.mimeType, 'audio/mpeg'), isNull(assets.deletedAt))
    )

  let changed = 0

  for (const row of rows) {
    const actual = Math.round(durationFromBytes(Number(row.sizeBytes)))
    if (actual === row.durationSec) continue

    await db.update(assets).set({ durationSec: actual }).where(eq(assets.id, row.id))

    const mm = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`
    console.log(`  ${row.title}  ${mm(row.durationSec ?? 0)} → ${mm(actual)}`)
    changed += 1
  }

  console.log(`  共更正 ${changed} 份`)
  process.exit(0)
}

void main()
