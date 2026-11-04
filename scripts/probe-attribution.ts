import { loadEnv } from '../src/lib/load-env'
loadEnv()

/** 正文裡有多少對白是「沒有點名是誰說的」。 */
async function main() {
  const { novelForReading } = await import('../src/lib/novel-export')
  const { isDialogue, speakerOf, knownNames } = await import('../src/lib/narration')
  const { db } = await import('../src/db')
  const { characters, projects } = await import('../src/db/schema')
  const { and, eq, isNull } = await import('drizzle-orm')

  const [project] = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(eq(projects.title, '一灶見山河'))
    .limit(1)
  if (!project) return process.exit(0)

  const cast = await db
    .select({ id: characters.id, name: characters.name, alias: characters.alias })
    .from(characters)
    .where(and(eq(characters.projectId, project.id), isNull(characters.deletedAt)))

  const names = knownNames(cast)
  const chapters = await novelForReading(project.id)

  let total = 0
  let dialogue = 0
  let attributed = 0
  const episodes = new Set<number>()

  for (const chapter of chapters) {
    episodes.add(chapter.episodeNumber)
    for (const paragraph of chapter.paragraphs) {
      total += 1
      if (!isDialogue(paragraph)) continue
      dialogue += 1
      if (speakerOf(paragraph, names).name) attributed += 1
    }
  }

  console.log(`  《${project.title}》已寫 ${episodes.size} 集，${chapters.length} 章，${total} 段`)
  console.log(`  角色表裡有 ${cast.length} 個角色`)
  console.log(`  對白段落 ${dialogue} 段（占 ${((dialogue / total) * 100).toFixed(0)}%）`)
  console.log(`  其中「規則判得出是誰說的」 ${attributed} 段`)
  console.log(`  判不出來的 ${dialogue - attributed} 段 → 這些全部會用旁白的聲音唸`)
  process.exit(0)
}
void main()
