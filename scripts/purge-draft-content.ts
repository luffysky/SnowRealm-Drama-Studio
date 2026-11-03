/**
 * Removes a project's novel and script drafts.
 *
 *   npx tsx scripts/purge-draft-content.ts --project yi-zao-jian-shan-he          # dry run
 *   npx tsx scripts/purge-draft-content.ts --project yi-zao-jian-shan-he --apply
 *   npx tsx scripts/purge-draft-content.ts --project … --kind SCRIPT --apply
 *
 * This exists because verifying the editors end to end means writing real
 * prose through the real API, and invented text must not be left behind in a
 * database whose whole point is that every figure comes from real work
 * (spec v3 §0).
 *
 * Dry run by default. It prints what it would delete, including character
 * counts, so a real draft is obvious before anything is removed.
 */
import { loadEnv } from '../src/lib/load-env'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]?.trim()
}

async function main(): Promise<void> {
  loadEnv()

  const projectRef = arg('project')
  const kind = arg('kind')?.toUpperCase()
  const apply = process.argv.includes('--apply')

  if (!projectRef) {
    console.error(
      '用法：npx tsx scripts/purge-draft-content.ts --project <slug 或 id> [--kind NOVEL|SCRIPT] [--apply]'
    )
    process.exit(1)
  }
  if (kind && kind !== 'NOVEL' && kind !== 'SCRIPT') {
    console.error('--kind 只接受 NOVEL 或 SCRIPT')
    process.exit(1)
  }

  const { and, eq, inArray, or } = await import('drizzle-orm')
  const { db, closeDb } = await import('../src/db')
  const { chapters, documents, episodes, projects, scenes, versions } = await import(
    '../src/db/schema'
  )
  const { isProjectId } = await import('../src/lib/project-access')

  const [project] = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(
      isProjectId(projectRef)
        ? or(eq(projects.id, projectRef), eq(projects.slug, projectRef))!
        : eq(projects.slug, projectRef)
    )
    .limit(1)

  if (!project) {
    console.error(`找不到作品：${projectRef}`)
    await closeDb()
    process.exit(1)
  }

  const docs = await db
    .select({
      id: documents.id,
      kind: documents.kind,
      charCount: documents.charCount,
      number: episodes.number,
    })
    .from(documents)
    .innerJoin(episodes, eq(episodes.id, documents.episodeId))
    .where(
      kind
        ? and(eq(episodes.projectId, project.id), eq(documents.kind, kind as 'NOVEL' | 'SCRIPT'))
        : eq(episodes.projectId, project.id)
    )

  if (docs.length === 0) {
    console.log(`《${project.title}》沒有${kind ? `${kind} ` : ''}稿件，無需處理。`)
    await closeDb()
    return
  }

  const ids = docs.map((d) => d.id)

  const [chapterRows, sceneRows, versionRows] = await Promise.all([
    db.select({ id: chapters.id }).from(chapters).where(inArray(chapters.documentId, ids)),
    db.select({ id: scenes.id }).from(scenes).where(inArray(scenes.documentId, ids)),
    db
      .select({ id: versions.id })
      .from(versions)
      .where(and(eq(versions.targetType, 'DOCUMENT'), inArray(versions.targetId, ids))),
  ])

  console.log(`\n《${project.title}》`)
  for (const doc of docs.sort((a, b) => a.number - b.number)) {
    console.log(
      `  EP${String(doc.number).padStart(3, '0')}  ${doc.kind.padEnd(6)} ${doc.charCount} 字`
    )
  }
  console.log(
    `\n將刪除：${docs.length} 份文件、${chapterRows.length} 章、${sceneRows.length} 場、${versionRows.length} 個版本`
  )

  const written = docs.filter((d) => d.charCount > 0)
  if (written.length > 0) {
    console.log(`\n⚠ 其中 ${written.length} 份已有內容，刪除後無法復原。`)
  }

  if (!apply) {
    console.log('\n（dry run，未變更任何資料。加上 --apply 才會實際刪除）\n')
    await closeDb()
    return
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(versions)
      .where(and(eq(versions.targetType, 'DOCUMENT'), inArray(versions.targetId, ids)))
    await tx.delete(scenes).where(inArray(scenes.documentId, ids))
    await tx.delete(chapters).where(inArray(chapters.documentId, ids))
    await tx.delete(documents).where(inArray(documents.id, ids))
  })

  console.log(`\n已刪除 ${docs.length} 份文件及其章節、場次與版本。\n`)
  await closeDb()
}

void main()
