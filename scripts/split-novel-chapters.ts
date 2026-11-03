import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { chapters, documents, episodes } from '@/db/schema'

/**
 * Moves chapters titled 「第 NNN 集｜標題」 onto the episode they name.
 *
 *   npx tsx scripts/split-novel-chapters.ts <projectId>           # dry run
 *   npx tsx scripts/split-novel-chapters.ts <projectId> --apply
 *
 * Why this exists: the novel was written as three chapters of EP001 whose
 * titles each named a different episode. Everything downstream counts by
 * episode — per-episode progress, 劇本改編, the export's chapter breaks — so it
 * all saw one written episode instead of three.
 *
 * It writes a JSON backup of every row it is about to touch before touching
 * anything, and does the move in one transaction. A chapter whose title does
 * not match the pattern is left exactly where it is.
 */

const TITLE = /^第\s*0*(\d+)\s*集\s*[｜|丨:：]\s*(.+)$/

type Plan = {
  chapterId: string
  chapterTitle: string
  fromEpisodeNumber: number
  toEpisodeNumber: number
  toEpisodeId: string
  newEpisodeTitle: string
  newChapterTitle: string
  charCount: number
}

async function main() {
  const projectId = process.argv[2]
  const apply = process.argv.includes('--apply')

  if (!projectId) {
    console.error('用法：npx tsx scripts/split-novel-chapters.ts <projectId> [--apply]')
    process.exit(1)
  }

  const episodeRows = await db
    .select({ id: episodes.id, number: episodes.number, title: episodes.title })
    .from(episodes)
    .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))
    .orderBy(asc(episodes.number))

  const byNumber = new Map(episodeRows.map((row) => [row.number, row]))

  const chapterRows = await db
    .select({
      id: chapters.id,
      documentId: chapters.documentId,
      sortOrder: chapters.sortOrder,
      title: chapters.title,
      charCount: chapters.charCount,
      episodeId: episodes.id,
      episodeNumber: episodes.number,
    })
    .from(chapters)
    .innerJoin(documents, eq(documents.id, chapters.documentId))
    .innerJoin(episodes, eq(episodes.id, documents.episodeId))
    .where(
      and(
        eq(episodes.projectId, projectId),
        eq(documents.kind, 'NOVEL'),
        isNull(documents.deletedAt),
        isNull(episodes.deletedAt)
      )
    )
    .orderBy(asc(episodes.number), asc(chapters.sortOrder))

  const plans: Plan[] = []
  const skipped: string[] = []

  for (const chapter of chapterRows) {
    const match = TITLE.exec(chapter.title.trim())
    if (!match) {
      skipped.push(`${chapter.title || '(未命名)'} — 標題不是「第 N 集｜…」`)
      continue
    }

    const target = Number(match[1])
    const name = (match[2] ?? '').trim()
    const episode = byNumber.get(target)

    if (!episode) {
      skipped.push(`${chapter.title} — 找不到第 ${target} 集`)
      continue
    }

    plans.push({
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      fromEpisodeNumber: chapter.episodeNumber,
      toEpisodeNumber: target,
      toEpisodeId: episode.id,
      newEpisodeTitle: name,
      newChapterTitle: name,
      charCount: chapter.charCount,
    })
  }

  console.log(`\n找到 ${chapterRows.length} 章，可以對應到集的有 ${plans.length} 章。\n`)

  for (const plan of plans) {
    const moving = plan.fromEpisodeNumber !== plan.toEpisodeNumber
    console.log(
      `  ${moving ? '搬移' : '留原處'}  EP${String(plan.fromEpisodeNumber).padStart(3, '0')}` +
        ` → EP${String(plan.toEpisodeNumber).padStart(3, '0')}` +
        `  ${plan.charCount.toLocaleString('en-US')} 字` +
        `  集名改成「${plan.newEpisodeTitle}」`
    )
  }

  if (skipped.length > 0) {
    console.log('\n不動的：')
    for (const line of skipped) console.log(`  ${line}`)
  }

  if (!apply) {
    console.log('\n這是試跑。確認沒問題後加 --apply 真的執行。\n')
    return
  }

  /* ---- backup ---------------------------------------------------------- */

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = 'backups'
  await mkdir(dir, { recursive: true })

  const backupPath = `${dir}/novel-split-${stamp}.json`
  await writeFile(
    backupPath,
    JSON.stringify({ projectId, episodes: episodeRows, chapters: chapterRows, plans }, null, 2),
    'utf8'
  )
  console.log(`\n備份寫到 ${backupPath}`)

  /* ---- apply ----------------------------------------------------------- */

  const touched = new Set<string>()

  await db.transaction(async (tx) => {
    for (const plan of plans) {
      // The destination episode may never have been opened, so its document
      // row may not exist yet — `openDocument` creates on first read.
      let [target] = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.episodeId, plan.toEpisodeId),
            eq(documents.kind, 'NOVEL'),
            isNull(documents.deletedAt)
          )
        )
        .limit(1)

      if (!target) {
        const [created] = await tx
          .insert(documents)
          .values({ episodeId: plan.toEpisodeId, kind: 'NOVEL' })
          .returning({ id: documents.id })
        target = created
      }

      if (!target) throw new Error(`無法建立 EP${plan.toEpisodeNumber} 的小說文件`)

      const [source] = await tx
        .select({ documentId: chapters.documentId })
        .from(chapters)
        .where(eq(chapters.id, plan.chapterId))
        .limit(1)

      if (source) touched.add(source.documentId)
      touched.add(target.id)

      // Append rather than assume 1: an episode that already has chapters must
      // not end up with two of them claiming the same position.
      const [last] = await tx
        .select({ max: sql<number>`coalesce(max(${chapters.sortOrder}), 0)`.mapWith(Number) })
        .from(chapters)
        .where(eq(chapters.documentId, target.id))

      const nextOrder = source?.documentId === target.id ? undefined : (last?.max ?? 0) + 1

      await tx
        .update(chapters)
        .set({
          documentId: target.id,
          title: plan.newChapterTitle,
          ...(nextOrder !== undefined ? { sortOrder: nextOrder } : {}),
          updatedAt: new Date(),
        })
        .where(eq(chapters.id, plan.chapterId))

      await tx
        .update(episodes)
        .set({ title: plan.newEpisodeTitle, updatedAt: new Date() })
        .where(eq(episodes.id, plan.toEpisodeId))
    }

    /*
     * Recount every document that gained or lost a chapter. A stale
     * `char_count` is what every progress figure on the dashboard reads, so
     * leaving it would make the move look like it lost the prose.
     */
    for (const documentId of touched) {
      const [sum] = await tx
        .select({ total: sql<number>`coalesce(sum(${chapters.charCount}), 0)`.mapWith(Number) })
        .from(chapters)
        .where(eq(chapters.documentId, documentId))

      await tx
        .update(documents)
        .set({
          charCount: sum?.total ?? 0,
          // Bump the optimistic lock: anyone holding this document open has a
          // stale view of it now, and their next save must be refused rather
          // than silently restore the old arrangement.
          lockRevision: sql`${documents.lockRevision} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId))
    }
  })

  console.log(`\n完成。更新了 ${touched.size} 份文件、${plans.length} 章。\n`)

  const after = await db
    .select({
      number: episodes.number,
      title: episodes.title,
      chars: documents.charCount,
      chapterCount: sql<number>`(
        select count(*) from ${chapters} where ${chapters}.document_id = ${documents.id}
      )`.mapWith(Number),
    })
    .from(episodes)
    .leftJoin(
      documents,
      and(
        eq(documents.episodeId, episodes.id),
        eq(documents.kind, 'NOVEL'),
        isNull(documents.deletedAt)
      )
    )
    .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))
    .orderBy(asc(episodes.number))

  for (const row of after.filter((r) => (r.chars ?? 0) > 0)) {
    console.log(
      `  EP${String(row.number).padStart(3, '0')}  ${JSON.stringify(row.title)}` +
        `  ${row.chapterCount} 章  ${(row.chars ?? 0).toLocaleString('en-US')} 字`
    )
  }
}

main().then(() => process.exit(0))
