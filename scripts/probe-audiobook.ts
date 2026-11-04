import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * 整集跑一次，證明會產出檔案。
 *
 * 模擬 worker 的多次呼叫：每一輪都有時間預算，做不完就回到佇列，下一輪接。
 * 這正是線上會發生的事，只是這裡由迴圈代替 worker 自己接力。
 */
async function main() {
  const { db } = await import('../src/db')
  const { assets, aiJobs, episodes, projects } = await import('../src/db/schema')
  const { and, asc, eq, isNull } = await import('drizzle-orm')
  const { voicePool, speechStatus } = await import('../src/lib/azure/speech')
  const { enqueueAudiobook, advanceAudiobook, audiobookProgress } = await import('../src/lib/tts/job')

  const status = await speechStatus()
  console.log(`  Azure：${status.available ? status.detail : '不可用 — ' + status.detail}`)
  if (!status.available) process.exit(1)

  const [project] = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects).where(eq(projects.title, '一灶見山河')).limit(1)
  if (!project) throw new Error('找不到作品')

  const [episode] = await db
    .select({ id: episodes.id, number: episodes.number })
    .from(episodes)
    .where(and(eq(episodes.projectId, project.id), isNull(episodes.deletedAt)))
    .orderBy(asc(episodes.number)).limit(1)
  if (!episode) throw new Error('找不到集數')

  // Clear any earlier attempt so this run starts clean.
  await db.delete(aiJobs).where(and(eq(aiJobs.episodeId, episode.id), eq(aiJobs.kind, 'NOVEL_TO_AUDIO')))

  const pool = await voicePool()
  const narrator = pool.find((v) => v.speaksChinese)!.id
  console.log(`  旁白音色：${narrator}`)

  const user = { id: (await db.select().from((await import('../src/db/schema')).users).limit(1))[0]!.id, name: '煙火' } as never

  const queued = await enqueueAudiobook({
    projectId: project.id,
    episodeId: episode.id,
    voices: pool.map((v) => ({ id: v.id, lang: v.locale, gender: v.gender, speaksChinese: v.speaksChinese })),
    narratorVoice: narrator,
    user,
  })

  console.log(`  排入：${queued.parts} 段，約 ${(queued.estimatedSec / 60).toFixed(1)} 分鐘，估 $${queued.estimatedCostUsd?.toFixed(4)}`)

  const started = Date.now()
  for (let pass = 1; pass <= 30; pass += 1) {
    const step = await advanceAudiobook(queued.jobId)
    const progress = await audiobookProgress(episode.id)
    console.log(`  第 ${pass} 輪：${step}  ${progress?.done}/${progress?.total} 段  ${progress?.note}`)
    if (step === 'succeeded') break
  }

  const final = await audiobookProgress(episode.id)
  console.log(`  總耗時 ${((Date.now() - started) / 1000).toFixed(1)} 秒`)

  if (final?.assetId) {
    const [asset] = await db.select().from(assets).where(eq(assets.id, final.assetId)).limit(1)
    console.log(`  ✓ 產出素材：${asset?.title}`)
    console.log(`    ${(Number(asset?.sizeBytes) / 1024 / 1024).toFixed(2)} MB，${asset?.durationSec} 秒`)
    console.log(`    objectKey ${asset?.objectKey}`)
  } else {
    console.log('  ✗ 沒有產出素材')
  }
  process.exit(0)
}
void main()
