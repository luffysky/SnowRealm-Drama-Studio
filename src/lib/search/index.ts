import crypto from 'node:crypto'
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  characters,
  chapters,
  documents,
  episodes,
  projects,
  scenes,
  searchDocuments,
  worldEntries,
  worldEvents,
} from '@/db/schema'
import { searchableTitles } from '@/lib/project-titles'
import type { SearchHit, SearchKind, SearchResult } from '@/lib/search/view'
import {
  EMBEDDING_MODEL,
  embed,
  embedOne,
  embeddingsConfigured,
} from '@/lib/search/embeddings'

/**
 * 智慧語意檢索.
 *
 * Hybrid by design. Semantic retrieval finds 「碼頭下雨的那場戲」 when nothing
 * in the text says 「下雨」; trigram matching finds 「EP007」 and 「沈知味」
 * exactly, which an embedding is bad at. Running both and merging is what
 * makes the box answer either kind of question.
 *
 * Trigram rather than `to_tsvector`: Postgres's built-in full-text search does
 * not segment Chinese, so 「碼頭的訂單」 becomes one token and the index is
 * useless for this corpus.
 */

export type { SearchKind, SearchHit, SearchResult } from '@/lib/search/view'
export { SEARCH_KIND_LABEL, SEARCH_KINDS, MATCHED_BY_LABEL } from '@/lib/search/view'

/**
 * Chunk size in characters.
 *
 * Measured, not guessed (`scripts/search-calibrate.ts` reproduces it). The
 * same true query against the same passage at three chunk sizes:
 *
 *   694 字 -> 0.346     378 字 -> 0.397     208 字 -> 0.396
 *
 * and a query about something the passage does *not* contain moved the other
 * way, 0.256 -> 0.232. A long chunk holds several topics and its vector is
 * their average, so a short query matches the average rather than the passage;
 * splitting the chunk widened the gap between a real hit and a near miss from
 * 0.09 to 0.165. Below ~380 there is no further gain and context starts to be
 * lost — 「他答應了」 means nothing without the sentence before it.
 */
const CHUNK_CHARS = 380
const CHUNK_OVERLAP = 70

/**
 * Score floors.
 *
 * Measured, and re-measurable: `npx tsx scripts/search-calibrate.ts` prints
 * the distribution and suggests this number. On this corpus, at 380-character
 * chunks, the run that produced the value below was:
 *
 *   命中  0.3991  「沈知味被潑醒」
 *   命中  0.5164  「三文錢的生意」
 *   命中  0.4158  「想辦法賺到第一筆錢」
 *   對照  0.3394  「她在繡房裡繡了一整幅嫁衣」   <- 同題材但文中沒有
 *   對照  0.2309  「太空船降落在火星表面」
 *   對照  0.1692  「兩軍在城外對陣，將軍下令放箭」
 *
 * 0.37 is the midpoint of the 0.339 / 0.399 gap. The margin is thin — the
 * nearest false positive is a period-domestic scene, which really is close in
 * meaning — so re-run the script once there is more than one chapter of prose.
 *
 * The value that was here before, 0.55, was a guess, and it sat above *every*
 * real hit in the corpus: the semantic half was switched off and nothing said
 * so, because the keyword half kept answering.
 */
const SEMANTIC_MIN = 0.37

/** Trigram similarity is noise below this; exact containment scores 1. */
const LEXICAL_MIN = 0.1

/* -------------------------------------------------------------------------- */
/* Indexing                                                                    */
/* -------------------------------------------------------------------------- */

type Indexable = {
  kind: SearchKind
  refId: string
  /** The episode this belongs to, when it belongs to one. Drives the link. */
  parentRefId?: string
  title: string
  text: string
}

/**
 * Rebuilds a project's index.
 *
 * Content that has not changed keeps its existing embedding — the hash check
 * is the entire cost control, and re-embedding an unchanged 120-episode novel
 * on every save would be the expensive mistake here.
 */
export async function reindexProject(projectId: string): Promise<{
  indexed: number
  embedded: number
  skipped: number
  semantic: boolean
  /** Why embeddings are missing, when a key is configured but the call failed. */
  error: string | null
}> {
  const sources = await collect(projectId)

  const rows = sources.flatMap((source) =>
    chunk(source.text).map((text, index) => ({
      kind: source.kind,
      refId: source.refId,
      parentRefId: source.parentRefId ?? null,
      chunkIndex: index,
      title: source.title,
      snippet: text.slice(0, 160),
      content: text,
      contentHash: hash(text),
    }))
  )

  // Drop index rows whose source is gone, so a deleted chapter stops
  // appearing in results.
  const liveKeys = new Set(rows.map((r) => `${r.kind}:${r.refId}:${r.chunkIndex}`))
  const existing = await db
    .select({
      id: searchDocuments.id,
      kind: searchDocuments.kind,
      refId: searchDocuments.refId,
      chunkIndex: searchDocuments.chunkIndex,
      contentHash: searchDocuments.contentHash,
      embedding: searchDocuments.embedding,
      embeddingModel: searchDocuments.embeddingModel,
    })
    .from(searchDocuments)
    .where(eq(searchDocuments.projectId, projectId))

  const stale = existing.filter(
    (row) => !liveKeys.has(`${row.kind}:${row.refId}:${row.chunkIndex}`)
  )
  if (stale.length > 0) {
    await db.delete(searchDocuments).where(
      inArray(
        searchDocuments.id,
        stale.map((r) => r.id)
      )
    )
  }

  const previous = new Map(
    existing.map((row) => [`${row.kind}:${row.refId}:${row.chunkIndex}`, row])
  )

  const needsEmbedding: typeof rows = []
  const reusable = new Map<string, { embedding: number[]; model: string }>()

  for (const row of rows) {
    const key = `${row.kind}:${row.refId}:${row.chunkIndex}`
    const before = previous.get(key)

    if (
      before &&
      before.contentHash === row.contentHash &&
      before.embedding &&
      before.embeddingModel === EMBEDDING_MODEL
    ) {
      reusable.set(key, { embedding: before.embedding, model: before.embeddingModel })
    } else {
      needsEmbedding.push(row)
    }
  }

  let embeddings: number[][] | null = null
  let error: string | null = null

  if (embeddingsConfigured() && needsEmbedding.length > 0) {
    try {
      embeddings = await embed(
        needsEmbedding.map((r) => r.content),
        'document'
      )
    } catch (cause) {
      /*
       * A throttled provider must not cost the whole index. The rows are
       * written either way — the keyword half works without embeddings — and
       * the reason is returned so the UI can say "索引建好了，但向量沒算完"
       * rather than either lying or showing a 500.
       *
       * Chunks that failed keep no embedding, so the next reindex retries
       * exactly those: the hash gate compares content, not vectors.
       */
      error = cause instanceof Error ? cause.message : String(cause)
    }
  }

  const embeddingFor = new Map<string, number[]>()
  if (embeddings) {
    needsEmbedding.forEach((row, index) => {
      const vector = embeddings![index]
      if (vector) embeddingFor.set(`${row.kind}:${row.refId}:${row.chunkIndex}`, vector)
    })
  }

  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200)

    await db
      .insert(searchDocuments)
      .values(
        batch.map((row) => {
          const key = `${row.kind}:${row.refId}:${row.chunkIndex}`
          const fresh = embeddingFor.get(key)
          const kept = reusable.get(key)

          return {
            projectId,
            kind: row.kind,
            refId: row.refId,
            parentRefId: row.parentRefId,
            chunkIndex: row.chunkIndex,
            title: row.title,
            snippet: row.snippet,
            content: row.content,
            embedding: fresh ?? kept?.embedding ?? null,
            embeddingModel: fresh ? EMBEDDING_MODEL : (kept?.model ?? ''),
            contentHash: row.contentHash,
            indexedAt: new Date(),
          }
        })
      )
      .onConflictDoUpdate({
        target: [searchDocuments.kind, searchDocuments.refId, searchDocuments.chunkIndex],
        set: {
          parentRefId: sql`excluded.parent_ref_id`,
          title: sql`excluded.title`,
          snippet: sql`excluded.snippet`,
          content: sql`excluded.content`,
          embedding: sql`excluded.embedding`,
          embeddingModel: sql`excluded.embedding_model`,
          contentHash: sql`excluded.content_hash`,
          indexedAt: sql`excluded.indexed_at`,
        },
      })
  }

  return {
    indexed: rows.length,
    embedded: embeddingFor.size,
    skipped: reusable.size,
    semantic: embeddingsConfigured(),
    error,
  }
}

/** Everything in a project worth searching, flattened. */
async function collect(projectId: string): Promise<Indexable[]> {
  const [project, episodeRows, chapterRows, sceneRows, entryRows, eventRows, characterRows] =
    await Promise.all([
      db
        .select({
          id: projects.id,
          title: projects.title,
          novelTitle: projects.novelTitle,
          dramaTitle: projects.dramaTitle,
          logline: projects.logline,
          synopsis: projects.synopsis,
          tags: projects.tags,
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1),

      db
        .select({
          id: episodes.id,
          number: episodes.number,
          title: episodes.title,
          logline: episodes.logline,
          synopsis: episodes.synopsis,
          notes: episodes.notes,
        })
        .from(episodes)
        .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt))),

      db
        .select({
          id: chapters.id,
          title: chapters.title,
          content: chapters.content,
          number: episodes.number,
          episodeId: episodes.id,
        })
        .from(chapters)
        .innerJoin(documents, eq(documents.id, chapters.documentId))
        .innerJoin(episodes, eq(episodes.id, documents.episodeId))
        .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt))),

      db
        .select({
          id: scenes.id,
          code: scenes.code,
          heading: scenes.heading,
          content: scenes.content,
          number: episodes.number,
          episodeId: episodes.id,
        })
        .from(scenes)
        .innerJoin(documents, eq(documents.id, scenes.documentId))
        .innerJoin(episodes, eq(episodes.id, documents.episodeId))
        .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt))),

      db
        .select({
          id: worldEntries.id,
          title: worldEntries.title,
          summary: worldEntries.summary,
          body: worldEntries.body,
        })
        .from(worldEntries)
        .where(and(eq(worldEntries.projectId, projectId), isNull(worldEntries.deletedAt))),

      db
        .select({
          id: worldEvents.id,
          title: worldEvents.title,
          description: worldEvents.description,
          eraLabel: worldEvents.eraLabel,
        })
        .from(worldEvents)
        .where(and(eq(worldEvents.projectId, projectId), isNull(worldEvents.deletedAt))),

      db
        .select({
          id: characters.id,
          name: characters.name,
          alias: characters.alias,
          personality: characters.personality,
          background: characters.background,
          growth: characters.growth,
          appearance: characters.appearance,
        })
        .from(characters)
        .where(and(eq(characters.projectId, projectId), isNull(characters.deletedAt))),
    ])

  const out: Indexable[] = []

  const row = project[0]
  if (row) {
    /*
     * All three names, so a member who only remembers the drama's release
     * title still finds the work (`@/lib/project-titles`).
     */
    const text = [...searchableTitles(row), row.tags.join(' '), row.logline, row.synopsis]
      .filter(Boolean)
      .join('\n')
    if (text.trim()) out.push({ kind: 'PROJECT', refId: row.id, title: row.title, text })
  }

  for (const episode of episodeRows) {
    const label = `EP${String(episode.number).padStart(3, '0')}`
    const text = [label, episode.title, episode.logline, episode.synopsis, episode.notes]
      .filter(Boolean)
      .join('\n')
    if (text.trim()) {
      out.push({
        kind: 'EPISODE',
        refId: episode.id,
        title: `${label} ${episode.title || '未命名'}`,
        text,
      })
    }
  }

  for (const chapter of chapterRows) {
    const text = stripHtml(chapter.content)
    if (!text.trim()) continue
    out.push({
      kind: 'CHAPTER',
      refId: chapter.id,
      parentRefId: chapter.episodeId,
      title: `EP${String(chapter.number).padStart(3, '0')}・${chapter.title || '未命名章節'}`,
      text: `${chapter.title}\n${text}`,
    })
  }

  for (const scene of sceneRows) {
    const text = stripHtml(scene.content)
    if (!text.trim()) continue
    out.push({
      kind: 'SCENE',
      refId: scene.id,
      parentRefId: scene.episodeId,
      title: `EP${String(scene.number).padStart(3, '0')}・${scene.code} ${scene.heading}`,
      text: `${scene.code} ${scene.heading}\n${text}`,
    })
  }

  for (const entry of entryRows) {
    const text = [entry.title, entry.summary, entry.body].filter(Boolean).join('\n')
    if (text.trim()) {
      out.push({ kind: 'WORLD_ENTRY', refId: entry.id, title: entry.title, text })
    }
  }

  for (const event of eventRows) {
    const text = [event.eraLabel, event.title, event.description].filter(Boolean).join('\n')
    if (text.trim()) {
      out.push({ kind: 'WORLD_EVENT', refId: event.id, title: event.title, text })
    }
  }

  for (const character of characterRows) {
    const text = [
      character.name,
      character.alias,
      character.personality,
      character.appearance,
      character.background,
      character.growth,
    ]
      .filter(Boolean)
      .join('\n')
    if (text.trim()) {
      out.push({ kind: 'CHARACTER', refId: character.id, title: character.name, text })
    }
  }

  return out
}

/**
 * Splits on paragraph boundaries where possible.
 *
 * A chunk cut mid-sentence embeds badly, and the overlap keeps a sentence that
 * straddles a boundary findable from either side.
 */
function chunk(text: string): string[] {
  const clean = text.replace(/\n{3,}/g, '\n\n').trim()
  if (clean.length <= CHUNK_CHARS) return clean ? [clean] : []

  const out: string[] = []
  let start = 0

  while (start < clean.length) {
    let end = Math.min(start + CHUNK_CHARS, clean.length)

    if (end < clean.length) {
      const breakAt = clean.lastIndexOf('\n', end)
      if (breakAt > start + CHUNK_CHARS / 2) end = breakAt
    }

    const piece = clean.slice(start, end).trim()
    if (piece) out.push(piece)

    if (end >= clean.length) break
    start = Math.max(end - CHUNK_OVERLAP, start + 1)
  }

  return out
}

function hash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 32)
}

function stripHtml(html: string): string {
  return html
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<br[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* -------------------------------------------------------------------------- */
/* Querying                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Hybrid search over one project.
 *
 * Both halves run and their scores are merged. A hit found by both ranks above
 * one found by either alone, which is the cheap and effective version of
 * reciprocal rank fusion for a corpus this size.
 */
export async function search(input: {
  /**
   * The projects to search. A workspace search passes one; the global palette
   * passes every project the member may see. An empty list searches nothing,
   * which is the right answer rather than everything.
   */
  projectIds: string[]
  query: string
  limit?: number
  kinds?: SearchKind[]
}): Promise<SearchResult> {
  const query = input.query.trim()
  const limit = input.limit ?? 20
  if (!query || input.projectIds.length === 0) {
    return { hits: [], semantic: embeddingsConfigured(), semanticError: null, total: 0 }
  }

  /*
   * A failed embedding must not be silent. Search still answers — the keyword
   * half needs no provider — but the reason travels with the result, because
   * "fewer results than expected" is indistinguishable from "that text does
   * not exist" unless the UI says which happened.
   */
  let semanticError: string | null = null
  const vector = await embedOne(query, 'query').catch((error: unknown) => {
    semanticError = error instanceof Error ? error.message : String(error)
    return null
  })

  const kindFilter =
    input.kinds && input.kinds.length > 0
      ? sql`and d.kind = any(${sql.raw(`ARRAY[${input.kinds.map((k) => `'${k}'`).join(',')}]`)})`
      : sql``

  /*
   * Containment, then fuzzy — in that order, and the order matters.
   *
   * `similarity(content, query)` compares two strings as wholes: a ten-character
   * query against a 700-character chunk shares almost none of its trigrams, so
   * it scores near zero even when the chunk contains the query verbatim. On its
   * own it finds titles and nothing else.
   *
   * `word_similarity()` is the usual fix, but it works on word extents, and
   * pg_trgm sees an unspaced Chinese sentence as one enormous word — so it
   * degrades back to the same comparison.
   *
   * What does work for this corpus is ILIKE containment, which the GIN trigram
   * index accelerates. An exact hit scores 1; anything else falls back to the
   * fuzzy comparison, which still catches a near-miss in a title.
   */
  const contains = `%${query.replace(/[%_\\]/g, (char) => `\\${char}`)}%`

  const lexical = sql`(
    case
      when d.content ilike ${contains} or d.title ilike ${contains} then 1.0
      else greatest(similarity(d.content, ${query}), similarity(d.title, ${query}))::double precision
    end
  )`

  const semantic = vector
    ? sql`coalesce(cosine_similarity(d.embedding, ${`{${vector.join(',')}}`}::real[]), 0)`
    : sql`0::double precision`

  /*
   * One query, both signals. Rows with no embedding simply score 0 on the
   * semantic side rather than being excluded.
   */
  const result = await db.execute<{
    id: string
    project_id: string
    project_title: string
    kind: string
    ref_id: string
    parent_ref_id: string | null
    title: string
    snippet: string
    lexical: number
    semantic: number
  }>(sql`
    select
      d.id,
      d.project_id,
      p.title as project_title,
      d.kind,
      d.ref_id,
      d.parent_ref_id,
      d.title,
      d.snippet,
      ${lexical} as lexical,
      ${semantic} as semantic
    from ${searchDocuments} d
    join ${projects} p on p.id = d.project_id
    where d.project_id = any(${sql.raw(`ARRAY[${input.projectIds.map((id) => `'${id}'`).join(',')}]::uuid[]`)})
      ${kindFilter}
    order by ${vector ? sql`(${semantic} * 0.65 + ${lexical} * 0.35)` : lexical} desc
    limit ${limit * 3}
  `)

  // node-postgres returns a QueryResult; the rows are on .rows.
  const scored = result.rows
    .map((row) => {
      const lexical = Number(row.lexical) || 0
      const semantic = Number(row.semantic) || 0

      const lexicalHit = lexical >= LEXICAL_MIN
      const semanticHit = semantic >= SEMANTIC_MIN

      return {
        id: row.id,
        projectId: row.project_id,
        projectTitle: row.project_title,
        kind: row.kind as SearchKind,
        refId: row.ref_id,
        parentRefId: row.parent_ref_id,
        title: row.title,
        snippet: row.snippet,
        score: vector ? semantic * 0.65 + lexical * 0.35 : lexical,
        matchedBy: (lexicalHit && semanticHit
          ? 'both'
          : semanticHit
            ? 'semantic'
            : 'lexical') as SearchHit['matchedBy'],
        lexicalHit,
        semanticHit,
      }
    })
    .filter((row) => row.lexicalHit || row.semanticHit)

  // One hit per source: several chunks of the same chapter is noise, and the
  // best-scoring chunk is the one worth showing.
  const best = new Map<string, (typeof scored)[number]>()
  for (const row of scored) {
    const key = `${row.projectId}:${row.kind}:${row.refId}`
    const current = best.get(key)
    if (!current || row.score > current.score) best.set(key, row)
  }

  const hits = [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      projectId: row.projectId,
      projectTitle: row.projectTitle,
      kind: row.kind,
      refId: row.refId,
      title: row.title,
      snippet: row.snippet,
      score: row.score,
      matchedBy: row.matchedBy,
      href: hrefFor(row.projectId, row.kind, row.refId, row.parentRefId),
    }))

  return { hits, semantic: Boolean(vector), semanticError, total: best.size }
}

/**
 * Where a hit takes you.
 *
 * Chapters and scenes live inside an episode's document, so with the episode
 * id the result opens the editor the text is actually in. Without it (a row
 * indexed before migration 0009) the link falls back to the list page, which
 * is worse but not broken.
 */
function hrefFor(
  projectId: string,
  kind: SearchKind,
  refId: string,
  parentRefId?: string | null
): string {
  switch (kind) {
    case 'PROJECT':
      return `/projects/${projectId}`
    case 'EPISODE':
      return `/projects/${projectId}/episodes?ep=${refId}`
    case 'CHAPTER':
      return parentRefId
        ? `/projects/${projectId}/episodes/${parentRefId}/novel?chapter=${refId}`
        : `/projects/${projectId}/novel`
    case 'SCENE':
      return parentRefId
        ? `/projects/${projectId}/episodes/${parentRefId}/script?scene=${refId}`
        : `/projects/${projectId}/scripts`
    case 'WORLD_ENTRY':
    case 'WORLD_EVENT':
      return `/projects/${projectId}/world`
    case 'CHARACTER':
      return `/projects/${projectId}/characters`
  }
}

/** Index freshness, for the settings page and the search footer. */
export async function indexStatus(projectId: string): Promise<{
  rows: number
  embedded: number
  lastIndexedAt: Date | null
  semantic: boolean
  /** Set when content changed after the last index. Null means current. */
  dirtySince: Date | null
}> {
  const [row] = await db
    .select({
      rows: sql<number>`count(*)`.mapWith(Number),
      embedded: sql<number>`count(*) filter (where ${searchDocuments.embedding} is not null)`.mapWith(
        Number
      ),
      /*
       * `.mapWith` is not optional here. A raw sql fragment bypasses the
       * column's driver mapping, so without it node-postgres hands back the
       * timestamp as a string while the signature promises a Date — and the
       * caller only finds out when it calls a Date method on it.
       */
      last: sql<Date | null>`max(${searchDocuments.indexedAt})`.mapWith(
        searchDocuments.indexedAt
      ),
    })
    .from(searchDocuments)
    .where(eq(searchDocuments.projectId, projectId))

  const [project] = await db
    .select({ dirtySince: projects.searchDirtyAt })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  return {
    rows: Number(row?.rows ?? 0),
    embedded: Number(row?.embedded ?? 0),
    lastIndexedAt: row?.last ?? null,
    semantic: embeddingsConfigured(),
    dirtySince: project?.dirtySince ?? null,
  }
}

/* -------------------------------------------------------------------------- */
/* 索引新鮮度                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Flags a project's index as behind the content.
 *
 * Called from every route that writes indexable text. It is one cheap UPDATE
 * and nothing else — crucially **not** a reindex: the novel editor autosaves
 * every 2.5 seconds, and embeddings are billed per token, so reindexing here
 * would charge the studio for a sentence being typed.
 *
 * Never throws. A write must not fail because bookkeeping did.
 */
export async function markSearchDirty(projectId: string): Promise<void> {
  try {
    await db
      .update(projects)
      .set({ searchDirtyAt: new Date() })
      .where(and(eq(projects.id, projectId), isNull(projects.searchDirtyAt)))
  } catch {
    // Bookkeeping only; the search panel still offers a manual rebuild.
  }
}

/** Reindexes every project whose content has moved on. Used by the cron. */
export async function reindexDirtyProjects(limit = 3): Promise<{
  reindexed: { projectId: string; indexed: number; embedded: number }[]
}> {
  const dirty = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(isNotNull(projects.searchDirtyAt), isNull(projects.deletedAt)))
    .orderBy(asc(projects.searchDirtyAt))
    .limit(limit)

  const reindexed: { projectId: string; indexed: number; embedded: number }[] = []

  for (const row of dirty) {
    /*
     * Cleared *before* the work, not after. If the reindex fails halfway the
     * flag is already down, which is the safe direction: the alternative is a
     * project that stays dirty forever and is re-embedded on every sweep.
     * A failed pass leaves unchanged chunks intact anyway, and the next
     * content write raises the flag again.
     */
    await db
      .update(projects)
      .set({ searchDirtyAt: null })
      .where(eq(projects.id, row.id))

    const result = await reindexProject(row.id).catch(() => null)
    if (result) {
      reindexed.push({
        projectId: row.id,
        indexed: result.indexed,
        embedded: result.embedded,
      })
    }
  }

  return { reindexed }
}
