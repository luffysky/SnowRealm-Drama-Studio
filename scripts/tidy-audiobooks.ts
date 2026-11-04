import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * 同一集只留最新的一份有聲書。
 *
 * 驗證期間 EP001 產了好幾次（修音色互撞、修音高），每一次都是一列素材。
 * 舊的那幾份是測試殘留，不是作品——留著只會讓素材庫看起來像壞掉的。
 *
 * 用 soft delete（這個 schema 的規矩，spec v2 §5）：檔案還在 R2，列還在，
 * 只是不再出現。真的要清掉空間是另一回事，由掃描腳本處理。
 */
async function main() {
  const { db } = await import('../src/db')
  const { assets, episodes } = await import('../src/db/schema')
  const { and, eq, isNull } = await import('drizzle-orm')

  const rows = await db
    .select({
      id: assets.id,
      episodeId: assets.episodeId,
      title: assets.title,
      createdAt: assets.createdAt,
      number: episodes.number,
    })
    .from(assets)
    .innerJoin(episodes, eq(episodes.id, assets.episodeId))
    .where(
      and(
        eq(assets.kind, 'VOICE'),
        eq(assets.uploadStatus, 'COMPLETED'),
        isNull(assets.deletedAt)
      )
    )

  const byEpisode = new Map<string, typeof rows>()
  for (const row of rows) {
    const list = byEpisode.get(row.episodeId!) ?? []
    list.push(row)
    byEpisode.set(row.episodeId!, list)
  }

  let removed = 0
  for (const [, list] of byEpisode) {
    if (list.length <= 1) continue

    const sorted = [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    const [keep, ...stale] = sorted
    console.log(
      `  EP${String(keep!.number).padStart(3, '0')}：留最新的一份，收起 ${stale.length} 份舊的`
    )

    for (const row of stale) {
      await db.update(assets).set({ deletedAt: new Date() }).where(eq(assets.id, row.id))
      removed += 1
    }
  }

  console.log(`  共收起 ${removed} 份重複的有聲書`)
  process.exit(0)
}

void main()
