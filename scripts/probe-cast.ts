import { loadEnv } from '../src/lib/load-env'
loadEnv()

/** The real pool against the real cast — what would actually be heard. */
async function main() {
  const { voicePool, VOICE_TIER_LABEL } = await import('../src/lib/azure/speech')
  const { assignVoices } = await import('../src/lib/narration')
  const { db } = await import('../src/db')
  const { characters, projects } = await import('../src/db/schema')
  const { and, eq, isNull } = await import('drizzle-orm')

  const pool = await voicePool()
  const byTier = new Map<string, number>()
  for (const v of pool) byTier.set(v.tier, (byTier.get(v.tier) ?? 0) + 1)

  console.log('  === 音色池（依序）===')
  for (const [tier, n] of byTier) {
    console.log(`  ${VOICE_TIER_LABEL[tier as keyof typeof VOICE_TIER_LABEL].padEnd(5)} ${String(n).padStart(3)} 個`)
  }
  console.log(`  合計 ${pool.length} 個，其中能唸中文的 ${pool.filter((v) => v.speaksChinese).length} 個`)

  const [project] = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(eq(projects.title, '一灶見山河'))
    .orderBy(projects.createdAt)
    .limit(1)
  if (!project) { console.log('  找不到作品'); process.exit(0) }

  const cast = await db
    .select({ id: characters.id, name: characters.name, gender: characters.gender, tier: characters.tier })
    .from(characters)
    .where(and(eq(characters.projectId, project.id), isNull(characters.deletedAt)))

  console.log(`\n  === 《${project.title}》${cast.length} 個角色的配音 ===`)
  const slots = assignVoices(
    cast.map((c) => ({ id: c.id, name: c.name, gender: c.gender ?? '', tier: c.tier })),
    pool.map((v) => ({ id: v.id, lang: v.locale, gender: v.gender, speaksChinese: v.speaksChinese }))
  )

  const used = new Set<string>()
  for (const member of cast) {
    const slot = slots[member.id]
    const voice = pool.find((v) => v.id === slot?.voiceId)
    if (slot?.voiceId) used.add(slot.voiceId)
    console.log(
      `  ${member.name.padEnd(8)} ${(member.gender || '—').padEnd(3)} → ` +
        `${(voice?.label ?? '—').padEnd(8)} ${(voice?.id ?? '—').padEnd(28)} ` +
        `${voice ? VOICE_TIER_LABEL[voice.tier] : ''} ${voice?.styles.length ? `風格 ${voice.styles.length} 種` : ''}`
    )
  }
  console.log(`\n  不同音色數：${used.size} / ${cast.length} 個角色`)
  process.exit(0)
}
void main()
