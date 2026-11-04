import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * 對白歸屬整趟跑一次：排入 → 執行 → 套用 → 看配音結果。
 *
 * 這是整件事的證明。沒有它，「多角色有聲書」就只是一個沒人驗過的說法。
 */
async function main() {
  const { db } = await import('../src/db')
  const { aiJobs, episodes, projects, users } = await import('../src/db/schema')
  const { and, asc, eq, isNull } = await import('drizzle-orm')
  const { enqueueAttribution, applyAttribution, speakersFor } = await import(
    '../src/lib/attribution-job'
  )
  const { runDueJobs } = await import('../src/lib/ai/queue')

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.title, '一灶見山河'))
    .limit(1)
  if (!project) throw new Error('找不到作品')

  const [episode] = await db
    .select({ id: episodes.id, number: episodes.number })
    .from(episodes)
    .where(and(eq(episodes.projectId, project.id), isNull(episodes.deletedAt)))
    .orderBy(asc(episodes.number))
    .limit(1)
  if (!episode) throw new Error('找不到集數')

  const [u] = await db.select().from(users).limit(1)
  const user = { id: u!.id, name: u!.name } as never

  const queued = await enqueueAttribution({
    projectId: project.id,
    episodeId: episode.id,
    user,
  })
  console.log(`  排入：要判斷 ${queued.asked} 句，規則已判出 ${queued.settled} 句`)

  const started = Date.now()
  for (let i = 1; i <= 8; i += 1) {
    await runDueJobs({ limit: 1 })
    const [job] = await db
      .select({ status: aiJobs.status, note: aiJobs.progressNote })
      .from(aiJobs)
      .where(eq(aiJobs.id, queued.jobId))
      .limit(1)
    console.log(`  第 ${i} 輪：${job?.status}  ${job?.note ?? ''}`)
    if (job?.status === 'AWAITING_REVIEW' || job?.status === 'FAILED') break
  }

  const [done] = await db.select().from(aiJobs).where(eq(aiJobs.id, queued.jobId)).limit(1)
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`  耗時 ${seconds} 秒，花費 ${done?.actualCost ?? '未回報'}`)

  if (done?.status !== 'AWAITING_REVIEW') {
    console.log(`  沒有產出：${done?.errorMessage ?? '未知'}`)
    process.exit(1)
  }

  const applied = await applyAttribution({ jobId: queued.jobId, user })
  console.log(`  套用：寫入 ${applied.written} 句，被擋掉 ${applied.rejected} 筆`)
  console.log(
    `  涵蓋：對白 ${applied.coverage.dialogue} 句，判出 ${applied.coverage.attributed} 句` +
      `（規則 ${applied.coverage.fromRules} ＋ 模型 ${applied.coverage.fromModel}）`
  )
  console.log(`  角色表沒有的人：${applied.newNames.join('、') || '（無）'}`)

  const speakers = await speakersFor(episode.id)
  const counts = new Map<string, number>()
  for (const name of speakers.values()) counts.set(name, (counts.get(name) ?? 0) + 1)

  console.log('  每個人講了幾句：')
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  for (const [name, n] of ranked.slice(0, 12)) {
    console.log(`    ${name.padEnd(12)} ${n} 句`)
  }

  process.exit(0)
}

void main()
