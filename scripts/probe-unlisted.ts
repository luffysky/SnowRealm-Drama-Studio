import { loadEnv } from '../src/lib/load-env'
loadEnv()

/** 誰在正文裡說過話卻不在角色表裡。 */
async function main() {
  const { db } = await import('../src/db')
  const { projects, characters } = await import('../src/db/schema')
  const { and, eq, isNull } = await import('drizzle-orm')
  const { unlistedSpeakers } = await import('../src/lib/attribution-job')

  const [project] = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(isNull(projects.deletedAt))
    .limit(1)
  if (!project) throw new Error('沒有作品')

  const listed = await db
    .select({ name: characters.name, tier: characters.tier, voiceId: characters.voiceId, voiceStyle: characters.voiceStyle })
    .from(characters)
    .where(and(eq(characters.projectId, project.id), isNull(characters.deletedAt)))

  console.log(`  角色表裡有 ${listed.length} 個：`)
  for (const row of listed) {
    console.log(`    ${row.name.padEnd(10)} ${row.tier.padEnd(12)} 音色「${row.voiceId || '未釘'}」 風格「${row.voiceStyle || '未設'}」`)
  }

  const unlisted = await unlistedSpeakers(project.id)
  console.log(`\n  說過話卻不在表裡的 ${unlisted.length} 個：`)
  for (const row of unlisted) {
    console.log(`    ${row.name.padEnd(10)} ${String(row.lines).padStart(3)} 句  性別「${row.gender || '不明'}」  出現於 EP${row.episodes.join(', EP')}`)
  }

  process.exit(0)
}

void main()
