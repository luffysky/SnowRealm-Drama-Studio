import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * 列出每一集有幾份有聲書。唯讀，什麼都不改。
 *
 * 驗證期間 EP001 產了好幾次（修音色互撞、修音高），每一次都是一列素材。
 * 舊的那幾份是測試殘留——有聲分頁只顯示最新的一份，所以它們不會干擾使用，
 * 但素材庫裡看得到。
 */
async function main() {
  const { db } = await import('../src/db')
  const { assets, episodes } = await import('../src/db/schema')
  const { and, asc, eq, isNull } = await import('drizzle-orm')

  const rows = await db
    .select({
      id: assets.id,
      number: episodes.number,
      title: assets.title,
      sizeBytes: assets.sizeBytes,
      createdAt: assets.createdAt,
    })
    .from(assets)
    .innerJoin(episodes, eq(episodes.id, assets.episodeId))
    .where(
      and(eq(assets.kind, 'VOICE'), eq(assets.uploadStatus, 'COMPLETED'), isNull(assets.deletedAt))
    )
    .orderBy(asc(episodes.number), asc(assets.createdAt))

  const byEpisode = new Map<number, typeof rows>()
  for (const row of rows) {
    const list = byEpisode.get(row.number) ?? []
    list.push(row)
    byEpisode.set(row.number, list)
  }

  for (const [number, list] of [...byEpisode.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  EP${String(number).padStart(3, '0')}：${list.length} 份`)
    list.forEach((row, index) => {
      const newest = index === list.length - 1
      const when = row.createdAt.toLocaleTimeString('zh-TW', { hour12: false })
      console.log(
        `    ${newest ? '← 最新（有聲分頁顯示這一份）' : '  舊的'}  ${when}  ` +
          `${(Number(row.sizeBytes) / 1024 / 1024).toFixed(2)} MB  ${row.id}`
      )
    })
  }

  const stale = [...byEpisode.values()].reduce((n, list) => n + Math.max(0, list.length - 1), 0)
  console.log(`  舊的共 ${stale} 份`)
  process.exit(0)
}

void main()
