import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * 存起來的長度跟實際音檔差多少。
 *
 * 回報：播放器顯示 15:01，耳機圖案旁邊寫 13 分 42 秒。
 * 後者是合成前用「字數 ÷ 每秒 3.9 字」估出來的，前者是瀏覽器讀檔案算的。
 */
async function main() {
  const { db } = await import('../src/db')
  const { assets, episodes } = await import('../src/db/schema')
  const { and, desc, eq, isNull } = await import('drizzle-orm')

  const rows = await db
    .select({
      id: assets.id,
      number: episodes.number,
      sizeBytes: assets.sizeBytes,
      durationSec: assets.durationSec,
      mimeType: assets.mimeType,
    })
    .from(assets)
    .innerJoin(episodes, eq(episodes.id, assets.episodeId))
    .where(
      and(eq(assets.kind, 'VOICE'), eq(assets.uploadStatus, 'COMPLETED'), isNull(assets.deletedAt))
    )
    .orderBy(desc(assets.createdAt))
    .limit(4)

  // Azure 送的格式是 audio-24khz-48kbitrate-mono-mp3——定位元率，
  // 所以秒數 = 位元組 × 8 ÷ 48000。
  const BITRATE = 48_000

  for (const row of rows) {
    const bytes = Number(row.sizeBytes)
    const fromBytes = (bytes * 8) / BITRATE
    const stored = row.durationSec ?? 0
    const mm = (n: number) => `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}`

    console.log(
      `  EP${String(row.number).padStart(3, '0')}  ${bytes.toLocaleString('zh-TW')} bytes`
    )
    console.log(
      `    存起來的 ${mm(stored)}（${stored}s）  照位元組算 ${mm(fromBytes)}（${fromBytes.toFixed(1)}s）` +
        `  差 ${(((fromBytes - stored) / fromBytes) * 100).toFixed(1)}%`
    )
  }

  process.exit(0)
}

void main()
