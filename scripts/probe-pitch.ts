import { loadEnv } from '../src/lib/load-env'
loadEnv()

/** 沈知味每一句實際用的音色、語速與音高。 */
async function main() {
  const { db } = await import('../src/db')
  const { episodes, projects } = await import('../src/db/schema')
  const { and, eq } = await import('drizzle-orm')
  const { voicePool } = await import('../src/lib/azure/speech')
  const { attributionFor } = await import('../src/lib/attribution-job')
  const { novelForReading } = await import('../src/lib/novel-export')
  const { splitForSpeech } = await import('../src/lib/speech-split')
  const { castChunks, castFromSpeakers } = await import('../src/lib/narration')
  const { characters } = await import('../src/db/schema')
  const { isNull } = await import('drizzle-orm')

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.title, '一灶見山河'))
    .limit(1)
  const [ep] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.projectId, project!.id), eq(episodes.number, 1)))
    .limit(1)

  const pool = await voicePool()
  const narrator = pool.find((v) => v.speaksChinese)!.id
  const { speakers, genders } = await attributionFor(ep!.id)

  const chapters = (await novelForReading(project!.id)).filter((c) => c.episodeId === ep!.id)
  const paragraphs = chapters.flatMap((c) => c.paragraphs)

  const cast = await db
    .select({
      id: characters.id,
      name: characters.name,
      gender: characters.gender,
      tier: characters.tier,
    })
    .from(characters)
    .where(and(eq(characters.projectId, project!.id), isNull(characters.deletedAt)))

  const members = cast.map((c) => ({
    id: c.id,
    name: c.name,
    gender: c.gender ?? '',
    tier: c.tier,
  }))

  const casted = castChunks(
    splitForSpeech(paragraphs),
    paragraphs,
    castFromSpeakers([...speakers.values()], members, genders),
    pool.map((v) => ({
      id: v.id,
      lang: v.locale,
      gender: v.gender,
      speaksChinese: v.speaksChinese,
    })),
    speakers,
    [narrator]
  )

  const hers = casted.filter((c) => c.speaker === '沈知味')
  console.log(`  沈知味共 ${hers.length} 個片段`)

  const combos = new Map<string, number>()
  for (const chunk of hers) {
    const key = `${chunk.voiceId ?? '（旁白）'}  rate ${(chunk.rate ?? 1).toFixed(3)}  pitch ${(chunk.pitch ?? 1).toFixed(3)}`
    combos.set(key, (combos.get(key) ?? 0) + 1)
  }

  console.log('  她用過的「音色＋語速＋音高」組合：')
  for (const [key, n] of [...combos.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${key}   ×${n}`)
  }

  console.log('')
  console.log('  她的前三句與後三句：')
  for (const chunk of [...hers.slice(0, 3), ...hers.slice(-3)]) {
    console.log(
      `    ${chunk.voiceId}  r${(chunk.rate ?? 1).toFixed(2)} p${(chunk.pitch ?? 1).toFixed(2)}  ${chunk.text.slice(0, 18)}`
    )
  }

  process.exit(0)
}

void main()
