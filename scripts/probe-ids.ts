import { loadEnv } from '../src/lib/load-env'
loadEnv()

/** 專案與音樂素材的 id，給截圖用。 */
async function main() {
  const { db } = await import('../src/db')
  const { projects, assets } = await import('../src/db/schema')
  const { and, eq, isNull } = await import('drizzle-orm')

  const rows = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(isNull(projects.deletedAt))

  for (const row of rows) {
    console.log(`PROJECT ${row.id} ${row.title}`)
    const music = await db
      .select({ id: assets.id, title: assets.title })
      .from(assets)
      .where(and(eq(assets.projectId, row.id), eq(assets.kind, 'MUSIC'), isNull(assets.deletedAt)))
    for (const m of music) console.log(`  MUSIC ${m.id} ${m.title}`)
  }

  process.exit(0)
}

void main()
