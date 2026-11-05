import { loadEnv } from '../src/lib/load-env'
loadEnv()

/** 三個回報的問題，各查各的。 */
async function main() {
  const { db } = await import('../src/db')
  const { assets, episodes, projects } = await import('../src/db/schema')
  const { and, eq, isNull } = await import('drizzle-orm')
  const { attributionFor } = await import('../src/lib/attribution-job')
  const { listNovels } = await import('../src/lib/library')
  const { users } = await import('../src/db/schema')

  console.log('  ===== 1. 書架上有幾本 =====')
  const [u] = await db.select({ id: users.id }).from(users).limit(1)
  const novels = await listNovels(u!.id)
  console.log(`  listNovels 回傳 ${novels.length} 本`)
  for (const novel of novels) {
    console.log(`    ${JSON.stringify(novel).slice(0, 160)}`)
  }

  const allProjects = await db
    .select({ id: projects.id, title: projects.title, status: projects.status })
    .from(projects)
    .where(isNull(projects.deletedAt))
  console.log(`  資料庫裡沒刪的作品 ${allProjects.length} 個：`)
  for (const row of allProjects) {
    const chars = await db.execute<{ n: string }>(
      (await import('drizzle-orm')).sql`
        select coalesce(sum(ch.char_count), 0)::text as n
          from chapters ch
          join documents d on d.id = ch.document_id
          join episodes e on e.id = d.episode_id
         where e.project_id = ${row.id} and d.kind = 'NOVEL' and d.deleted_at is null`
    )
    console.log(`    ${row.title}  狀態 ${row.status}  正文 ${chars.rows[0]?.n ?? 0} 字`)
  }

  console.log('')
  console.log('  ===== 2. 有幾集有聲音 =====')
  const audio = await db
    .select({ episodeId: assets.episodeId, title: assets.title })
    .from(assets)
    .where(
      and(eq(assets.kind, 'VOICE'), eq(assets.uploadStatus, 'COMPLETED'), isNull(assets.deletedAt))
    )
  console.log(`  有聲書素材 ${audio.length} 個：${audio.map((a) => a.title).join('、')}`)

  console.log('')
  console.log('  ===== 3. 沈知味的聲音前後不一樣 =====')
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.title, '一灶見山河'))
    .orderBy(projects.createdAt)
    .limit(1)
  const [ep] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.projectId, project!.id), eq(episodes.number, 1)))
    .limit(1)

  const { speakers } = await attributionFor(ep!.id)
  const { novelForReading } = await import('../src/lib/novel-export')
  const { isDialogue } = await import('../src/lib/narration')

  const chapters = (await novelForReading(project!.id)).filter((c) => c.episodeId === ep!.id)
  const paragraphs = chapters.flatMap((c) => c.paragraphs)

  const dialogue: number[] = []
  paragraphs.forEach((text, index) => {
    if (isDialogue(text)) dialogue.push(index)
  })

  const unattributed = dialogue.filter((index) => !speakers.has(index))
  console.log(`  對白 ${dialogue.length} 段，沒有歸屬的 ${unattributed.length} 段`)
  console.log(`  沒歸屬的段號：${unattributed.join('、') || '（無）'}`)
  for (const index of unattributed.slice(0, 5)) {
    console.log(`    [${index}] ${paragraphs[index]?.slice(0, 40)}`)
  }

  // 她的名字有沒有被記成不同寫法
  const names = [...new Set(speakers.values())]
  const variants = names.filter((n) => n.includes('知味') || n.includes('沈'))
  console.log(`  含「沈」或「知味」的說話人寫法：${variants.join('、')}`)

  process.exit(0)
}

void main()
