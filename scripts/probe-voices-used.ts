import { loadEnv } from '../src/lib/load-env'
loadEnv()

/** 這一集的 SSML 裡到底用了幾個不同的音色，誰配到誰。 */
async function main() {
  const { db } = await import('../src/db')
  const { episodes, projects } = await import('../src/db/schema')
  const { and, asc, eq, isNull } = await import('drizzle-orm')
  const { voicePool } = await import('../src/lib/azure/speech')
  const { planEpisodeAudio } = await import('../src/lib/tts/audiobook')
  const { attributionFor } = await import('../src/lib/attribution-job')

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

  const pool = await voicePool()
  const narrator = pool.find((voice) => voice.speaksChinese)!.id
  const { speakers, genders } = await attributionFor(episode.id)

  const plan = await planEpisodeAudio({
    projectId: project.id,
    episodeId: episode.id,
    voices: pool.map((voice) => ({
      id: voice.id,
      lang: voice.locale,
      gender: voice.gender,
      speaksChinese: voice.speaksChinese,
    })),
    narratorVoice: narrator,
    speakers,
    genders,
  })

  const used = new Set<string>()
  for (const xml of plan.ssml) {
    for (const match of xml.matchAll(/<voice name="([^"]+)"/g)) used.add(match[1]!)
  }

  const label = new Map(pool.map((voice) => [voice.id, voice]))

  console.log(`  SSML 裡出現 ${used.size} 個不同音色（含旁白）`)
  console.log(`  旁白：${narrator}  ${label.get(narrator)?.label ?? ''}`)
  console.log('  角色的配音：')
  for (const member of plan.cast) {
    const voice = member.voiceId ? label.get(member.voiceId) : null
    console.log(
      `    ${member.name.padEnd(12)} ${(voice?.label ?? '（旁白）').padEnd(8)} ` +
        `${(genders.get(member.name) || '？').padEnd(2)} → ${voice?.gender ?? ''}`
    )
  }

  process.exit(0)
}

void main()
