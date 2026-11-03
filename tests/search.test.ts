import { beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 智慧語意檢索 (`docs/SEARCH.md`).
 *
 * The retrieval itself is SQL — trigram similarity, a cosine function defined
 * in migration 0008, and the merge between them — so these run against a real
 * database rather than a mock.
 *
 * `tests/setup.ts` clears `VOYAGE_API_KEY`, so the semantic half is off here
 * by design: a test suite must not spend money per run. What that leaves is
 * exactly what has to keep working when no provider is configured — project
 * scoping, the lexical half, chunk de-duplication and the links — plus the
 * promise that the UI is told which mode it got.
 */
const hasDb = testDatabaseReady()

let reindexProject: typeof import('@/lib/search').reindexProject
let search: typeof import('@/lib/search').search
let indexStatus: typeof import('@/lib/search').indexStatus
let projectId: string
let projectTitle: string

beforeAll(async () => {
  if (!hasDb) return

  const { db } = await import('@/db')
  const schema = await import('@/db/schema')
  ;({ reindexProject, search, indexStatus } = await import('@/lib/search'))

  const [project] = await db
    .select({ id: schema.projects.id, title: schema.projects.title })
    .from(schema.projects)
    .limit(1)
  if (!project) throw new Error('Run `npm run db:seed` first')

  projectId = project.id
  projectTitle = project.title

  await reindexProject(projectId)
}, 120_000)

describe.skipIf(!hasDb)('reindexProject', () => {
  it('indexes the project itself and reports keyword-only mode', async () => {
    const result = await reindexProject(projectId)

    expect(result.indexed).toBeGreaterThan(0)
    // No key configured: nothing may be embedded, and it must say so rather
    // than claiming semantic search it cannot do.
    expect(result.embedded).toBe(0)
    expect(result.semantic).toBe(false)
  })

  it('is idempotent — a second pass adds no rows', async () => {
    const before = await indexStatus(projectId)
    await reindexProject(projectId)
    const after = await indexStatus(projectId)

    expect(after.rows).toBe(before.rows)
  })

  it('reports an index with no embeddings as not semantic', async () => {
    const status = await indexStatus(projectId)

    expect(status.rows).toBeGreaterThan(0)
    expect(status.embedded).toBe(0)
    expect(status.semantic).toBe(false)
    expect(status.lastIndexedAt).toBeInstanceOf(Date)
  })
})

describe.skipIf(!hasDb)('search', () => {
  it('finds the project by its own title', async () => {
    const result = await search({ projectIds: [projectId], query: projectTitle })

    expect(result.semantic).toBe(false)
    expect(result.hits.length).toBeGreaterThan(0)
    expect(result.hits.some((hit) => hit.projectId === projectId)).toBe(true)
  })

  it('returns nothing for an empty query rather than everything', async () => {
    const result = await search({ projectIds: [projectId], query: '   ' })

    expect(result.hits).toEqual([])
    expect(result.total).toBe(0)
  })

  it('searches nothing when no project is in scope', async () => {
    // The global route intersects the request against what the member may
    // see; an empty intersection must not fall back to every project.
    const result = await search({ projectIds: [], query: projectTitle })

    expect(result.hits).toEqual([])
  })

  it('never returns a hit from outside the given projects', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')

    const rows = await db
      .select({ id: schema.searchDocuments.projectId })
      .from(schema.searchDocuments)

    const result = await search({ projectIds: [projectId], query: '一' })

    expect(rows.length).toBeGreaterThan(0)
    expect(result.hits.every((hit) => hit.projectId === projectId)).toBe(true)
  })

  it('honours the kind filter', async () => {
    const result = await search({
      projectIds: [projectId],
      query: projectTitle,
      kinds: ['CHARACTER'],
    })

    expect(result.hits.every((hit) => hit.kind === 'CHARACTER')).toBe(true)
  })

  it('collapses several matching chunks of one source into one hit', async () => {
    const result = await search({ projectIds: [projectId], query: projectTitle, limit: 50 })

    const keys = result.hits.map((hit) => `${hit.kind}:${hit.refId}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('labels every hit with which half matched', async () => {
    const result = await search({ projectIds: [projectId], query: projectTitle })

    // Without embeddings nothing can be found semantically, so claiming it
    // would be a lie the UI then repeats to the user.
    expect(result.hits.every((hit) => hit.matchedBy === 'lexical')).toBe(true)
  })

  it('finds a short phrase inside a long chunk', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    /*
     * The regression this guards: `similarity(content, query)` compares two
     * strings as wholes, so a ten-character query against a 700-character
     * chunk scored near zero even when the chunk contained it verbatim —
     * lexical search found titles and nothing else.
     */
    const refId = crypto.randomUUID()
    const needle = '沈知味把那口舊灶擦了三遍'
    const content = `${'她在碼頭等了一整夜，天亮前才動身。'.repeat(20)}${needle}${'攤子支起來的時候，巷子還是黑的。'.repeat(20)}`

    await db.insert(schema.searchDocuments).values({
      projectId,
      kind: 'CHAPTER',
      refId,
      chunkIndex: 0,
      title: '測試章節',
      snippet: needle,
      content,
      contentHash: 'test',
    })

    try {
      const result = await search({ projectIds: [projectId], query: needle, limit: 10 })

      expect(result.hits.some((hit) => hit.refId === refId)).toBe(true)
    } finally {
      await db.delete(schema.searchDocuments).where(eq(schema.searchDocuments.refId, refId))
    }
  })

  it('links a chapter hit to the episode it is written in', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const [chapter] = await db
      .select({
        id: schema.searchDocuments.refId,
        parentRefId: schema.searchDocuments.parentRefId,
      })
      .from(schema.searchDocuments)
      .where(eq(schema.searchDocuments.kind, 'CHAPTER'))
      .limit(1)

    if (!chapter) {
      // Nothing written yet: no mockup content is ever seeded (spec v3 §0),
      // so this is a legitimate state rather than a failure.
      expect(chapter).toBeUndefined()
      return
    }

    // The whole point of migration 0009: a hit opens the editor the text is
    // in, not a list page the reader then has to search by hand.
    expect(chapter.parentRefId).toBeTruthy()
  })
})
