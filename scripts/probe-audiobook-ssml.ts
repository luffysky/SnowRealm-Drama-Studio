import { loadEnv } from '../src/lib/load-env'
loadEnv()

/**
 * 重新算一次 EP001 的 SSML，看三個修正到不到位 (Z140).
 *
 * 只算不送——`planEpisodeAudio` 不碰合成端點，所以這支不花錢。要驗的是
 * **送出去的那串字**，而那串字在合成之前就完全決定了。
 */
async function main() {
  const { db } = await import('../src/db')
  const { episodes, projects } = await import('../src/db/schema')
  const { and, eq, isNull } = await import('drizzle-orm')
  const { voicePool } = await import('../src/lib/azure/speech')
  const { attributionFor } = await import('../src/lib/attribution-job')
  const { planEpisodeAudio } = await import('../src/lib/tts/audiobook')
  const { canCorrect } = await import('../src/lib/tts/pronounce')

  const [project] = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(isNull(projects.deletedAt))
    .limit(1)
  if (!project) throw new Error('沒有作品')

  const rows = await db
    .select({ id: episodes.id, number: episodes.number, title: episodes.title })
    .from(episodes)
    .where(and(eq(episodes.projectId, project.id), isNull(episodes.deletedAt)))
    .orderBy(episodes.number)
    .limit(2)

  const pool = await voicePool()
  const narrator = pool.find((voice) => voice.speaksChinese)?.id ?? ''

  console.log(`  作品：${project.title}`)
  console.log(`  旁白音色：${narrator}  破音字改得動：${canCorrect(narrator) ? '✓' : '✗'}\n`)

  for (const episode of rows) {
    const { speakers, genders } = await attributionFor(episode.id)

    const plan = await planEpisodeAudio({
      projectId: project.id,
      episodeId: episode.id,
      voices: pool.map((voice) => ({
        id: voice.id,
        lang: voice.locale,
        styles: voice.styles,
        gender: voice.gender,
        speaksChinese: voice.speaksChinese,
      })),
      narratorVoice: narrator,
      ...(speakers.size > 0 ? { speakers, genders } : {}),
    })

    const all = plan.ssml.join('')

    const phonemes = all.match(/<phoneme[^>]*ph="([^"]+)"[^>]*>(.)<\/phoneme>/g) ?? []
    const styles = all.match(/<mstts:express-as style="([^"]+)"/g) ?? []
    const pauses = all.match(/<break time="(\d+)ms"\/>/g) ?? []
    const stars = (all.match(/\*/g) ?? []).length

    const styleCount = new Map<string, number>()
    for (const hit of styles) {
      const name = /style="([^"]+)"/.exec(hit)?.[1] ?? '?'
      styleCount.set(name, (styleCount.get(name) ?? 0) + 1)
    }

    const phonemeCount = new Map<string, number>()
    for (const hit of phonemes) {
      const found = /ph="([^"]+)"[^>]*>(.)</.exec(hit)
      if (!found) continue
      const key = `${found[2]} → ${found[1]}`
      phonemeCount.set(key, (phonemeCount.get(key) ?? 0) + 1)
    }

    console.log(`=== EP${String(episode.number).padStart(3, '0')} ${episode.title} ===`)
    console.log(`  ${plan.batches.length} 段，${plan.billableChars} 個計費字元，${plan.cast.length} 個聲音`)
    console.log(`  歸屬過的對白：${speakers.size}`)
    console.log(`  星號：${stars} 個${stars === 0 ? '  ✓' : '  ✗ 還會唸出來'}`)
    console.log(`  場景靜音：${pauses.length} 處`)

    console.log(`  破音字修正：${phonemes.length} 處`)
    for (const [key, count] of [...phonemeCount].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${key}  × ${count}`)
    }

    console.log(`  情緒風格：${styles.length} 處`)
    for (const [name, count] of [...styleCount].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${name.padEnd(14)} × ${count}`)
    }

    // 哪些角色拿到了改不動破音字的音色——那是選音色時要講出來的事。
    const blind = plan.cast.filter((row) => row.voiceId && !canCorrect(row.voiceId))
    if (blind.length > 0) {
      console.log(`  這些角色的音色改不動破音字：`)
      for (const row of blind) console.log(`      ${row.name}  ${row.voiceId}`)
    }
    console.log()
  }

  process.exit(0)
}

void main()
