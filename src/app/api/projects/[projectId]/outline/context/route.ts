import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm'
import { db } from '@/db'
import { episodes } from '@/db/schema'
import { handle, jsonOk, requirePermission } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { stripHtmlToText } from '@/lib/utils'

export const runtime = 'nodejs'

/**
 * Assembles what the model should know before writing outlines for a range.
 *
 * Built on the server because it reaches into the prose. The generator used to
 * send only each episode's `logline` / `synopsis`, which meant a project where
 * someone had written 3,000 characters of EP001 but had not yet written an
 * outline sent the model *nothing* — and the model, correctly, refused to
 * invent a story it had not been shown.
 *
 * Everything here is bounded. The point is to give the model enough to
 * continue from, not to pay to re-read the whole novel on every request.
 */

/**
 * All of an episode's novel prose, in chapter order.
 *
 * Written as raw SQL with explicit aliases rather than interpolated columns:
 * inside a `sql` template Drizzle emits a bare `"id"` with no table
 * qualification, so `join documents on ${documents.id} = ${chapters.documentId}`
 * renders as `on "id" = "document_id"` — ambiguous, and comparing the wrong
 * columns. It fails loudly here; in a wider query it could silently match.
 */
const PROSE_SQL = sql<string>`coalesce((
  select string_agg(c.content, chr(10) order by c.sort_order)
    from chapters c
    join documents d on d.id = c.document_id
   where d.episode_id = episodes.id
     and d.kind = 'NOVEL'
     and d.deleted_at is null
), '')`

/** Prose kept per episode inside the range: enough to summarise from. */
const IN_RANGE_CHARS = 1500

/** Prose kept from the episode before the range, to continue from. */
const PRECEDING_CHARS = 800

export const GET = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requirePermission('project.read')
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const url = new URL(request.url)
    const from = Math.max(1, Number(url.searchParams.get('from')) || 1)
    const to = Math.max(from, Number(url.searchParams.get('to')) || from)

    const rows = await db
      .select({
        id: episodes.id,
        number: episodes.number,
        title: episodes.title,
        logline: episodes.logline,
        synopsis: episodes.synopsis,
        prose: PROSE_SQL,
      })
      .from(episodes)
      .where(
        and(
          eq(episodes.projectId, projectId),
          isNull(episodes.deletedAt),
          sql`${episodes.number} >= ${from}`,
          sql`${episodes.number} <= ${to}`
        )
      )
      .orderBy(asc(episodes.number))

    const lines: string[] = [
      `請為第 ${from} 集到第 ${to} 集寫分集大綱，共 ${rows.length} 集。`,
      '',
    ]

    let writtenCount = 0

    for (const row of rows) {
      const label = `EP${String(row.number).padStart(3, '0')}`
      const prose = stripHtmlToText(row.prose).trim()

      if (prose) {
        writtenCount += 1
        /*
         * When the prose exists the task changes shape: the outline should
         * describe what was actually written, not invent a parallel version.
         */
        lines.push(
          `${label} 已經寫好正文，請據此整理大綱（不要改動已寫的劇情）：`,
          prose.slice(0, IN_RANGE_CHARS) +
            (prose.length > IN_RANGE_CHARS ? `\n……（正文共 ${prose.length} 字，以上為開頭）` : ''),
          ''
        )
        continue
      }

      const existing = [row.title, row.logline, row.synopsis].filter(Boolean).join('｜')
      lines.push(existing ? `${label} 已有：${existing}` : `${label} 尚未撰寫`)
    }

    /*
     * The episode before the range anchors continuity. Its outline if it has
     * one; otherwise the tail of its prose, which is what the next episode has
     * to pick up from.
     */
    const [before] = await db
      .select({
        number: episodes.number,
        logline: episodes.logline,
        synopsis: episodes.synopsis,
        prose: PROSE_SQL,
      })
      .from(episodes)
      .where(
        and(
          eq(episodes.projectId, projectId),
          isNull(episodes.deletedAt),
          lt(episodes.number, from)
        )
      )
      .orderBy(sql`${episodes.number} desc`)
      .limit(1)

    if (before) {
      const label = `EP${String(before.number).padStart(3, '0')}`
      const outline = [before.logline, before.synopsis].filter(Boolean).join('\n')
      const prose = stripHtmlToText(before.prose).trim()

      if (outline) {
        lines.push('', `前一集（${label}）的大綱，用來接續：`, outline)
      } else if (prose) {
        lines.push(
          '',
          `前一集（${label}）的正文結尾，用來接續：`,
          `……${prose.slice(-PRECEDING_CHARS)}`
        )
      }
    }

    return jsonOk({
      sourceText: lines.join('\n').trim(),
      episodeCount: rows.length,
      /** How many in the range already have prose — changes what to ask for. */
      writtenCount,
    })
  }
)
