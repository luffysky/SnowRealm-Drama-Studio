/**
 * Measures the semantic score distribution for this corpus.
 *
 *   npx tsx scripts/search-calibrate.ts
 *   npx tsx scripts/search-calibrate.ts --project <uuid>
 *
 * Why this exists: `SEMANTIC_MIN` in `src/lib/search/index.ts` decides whether
 * a semantic match counts. The first value there was a guess, and it sat above
 * *every* real hit in the corpus — the semantic half was switched off and
 * nothing said so, because the keyword half kept answering. A threshold that
 * is guessed is a threshold nobody can check.
 *
 * So: run two sets of queries past the real index and print what they score.
 *
 *   POSITIVE — things that are genuinely in the text
 *   NEGATIVE — same genre, same period, deliberately *not* in the text
 *
 * A usable threshold sits in the gap between them. If the two sets overlap,
 * the problem is not the threshold: it is chunk size (see `CHUNK_CHARS`).
 *
 * Costs money: one embedding request per run. An account with no payment
 * method on file is limited to 3 requests per minute, which is why every
 * query goes out in a single batch.
 */
import { loadEnv } from '@/lib/load-env'

/** Edit these to match whatever the project is actually about. */
const POSITIVE = [
  '沈知味被潑醒',
  '三文錢的生意',
  '想辦法賺到第一筆錢',
]

const NEGATIVE = [
  '朝廷科舉放榜，書生名落孫山',
  '兩軍在城外對陣，將軍下令放箭',
  '她在繡房裡繡了一整幅嫁衣',
  '太空船降落在火星表面',
]

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? null : (process.argv[index + 1] ?? null)
}

async function main() {
  loadEnv()

  const { db } = await import('@/db')
  const schema = await import('@/db/schema')
  const { eq, sql } = await import('drizzle-orm')
  const { embed, embeddingsConfigured, EMBEDDING_MODEL } = await import(
    '@/lib/search/embeddings'
  )

  if (!embeddingsConfigured()) {
    console.error('沒有 VOYAGE_API_KEY，無法校準。見 docs/SEARCH.md §5')
    process.exit(1)
  }

  const requested = arg('project')
  const [project] = requested
    ? await db
        .select({ id: schema.projects.id, title: schema.projects.title })
        .from(schema.projects)
        .where(eq(schema.projects.id, requested))
        .limit(1)
    : await db
        .select({ id: schema.projects.id, title: schema.projects.title })
        .from(schema.projects)
        .limit(1)

  if (!project) {
    console.error('找不到作品')
    process.exit(1)
  }

  const [size] = await db
    .select({
      chunks: sql<number>`count(*)`.mapWith(Number),
      embedded: sql<number>`count(*) filter (where embedding is not null)`.mapWith(Number),
      avgChars: sql<number>`coalesce(avg(length(content)), 0)`.mapWith(Number),
    })
    .from(schema.searchDocuments)
    .where(eq(schema.searchDocuments.projectId, project.id))

  console.log(`作品：${project.title}`)
  console.log(
    `索引：${size?.chunks ?? 0} 段，已向量化 ${size?.embedded ?? 0} 段，` +
      `平均 ${Math.round(size?.avgChars ?? 0)} 字／段`
  )
  console.log(`模型：${EMBEDDING_MODEL}\n`)

  if (!size?.embedded) {
    console.error('索引裡沒有向量。先在搜尋面板按「重建索引」。')
    process.exit(1)
  }

  // One request for every query: the free tier allows three a minute.
  const queries = [...POSITIVE, ...NEGATIVE]
  const vectors = await embed(queries, 'query')
  if (!vectors) {
    console.error('embed 回傳 null')
    process.exit(1)
  }

  const best: { label: string; query: string; score: number }[] = []

  for (const [index, query] of queries.entries()) {
    const vector = vectors[index]!
    const rows = await db.execute<{ score: number; kind: string; title: string }>(sql`
      select
        cosine_similarity(embedding, ${`{${vector.join(',')}}`}::real[]) as score,
        kind,
        title
      from search_documents
      where project_id = ${project.id} and embedding is not null
      order by score desc
      limit 1
    `)

    const top = rows.rows[0]
    const score = Number(top?.score ?? 0)
    const label = index < POSITIVE.length ? '命中' : '對照'
    best.push({ label, query, score })

    console.log(
      `${label}  ${score.toFixed(4)}  「${query}」  -> ${top?.kind ?? '-'} ${top?.title ?? ''}`
    )
  }

  const positives = best.filter((row) => row.label === '命中').map((row) => row.score)
  const negatives = best.filter((row) => row.label === '對照').map((row) => row.score)

  const lowestHit = Math.min(...positives)
  const highestMiss = Math.max(...negatives)

  console.log(`\n最低的命中  ${lowestHit.toFixed(4)}`)
  console.log(`最高的對照  ${highestMiss.toFixed(4)}`)

  if (lowestHit <= highestMiss) {
    console.log(
      '\n⚠ 兩組重疊了。這不是門檻調得好不好的問題——' +
        '先把 CHUNK_CHARS 調小（一段塞太多主題，向量會被平均掉），再回來量一次。'
    )
  } else {
    const suggested = (lowestHit + highestMiss) / 2
    console.log(`\n建議的 SEMANTIC_MIN：${suggested.toFixed(2)}（取兩組中間）`)
  }

  process.exit(0)
}

void main()
