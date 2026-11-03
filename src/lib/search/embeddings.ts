/**
 * Embeddings, via Voyage AI.
 *
 * Claude has no embeddings endpoint, so semantic search needs a second
 * provider. Voyage is Anthropic's recommended partner and `voyage-4` is
 * multilingual, which matters here — the corpus is Traditional Chinese prose.
 *
 * Without `VOYAGE_API_KEY` every function here returns null and search falls
 * back to trigram matching. That is a real degradation, not a silent one: the
 * search UI says which mode it is in.
 */

export const EMBEDDING_MODEL = process.env.VOYAGE_MODEL?.trim() || 'voyage-4'

/** Must match the `real[]` length the index was built with. */
export const EMBEDDING_DIMENSIONS = 1024

/**
 * Which host serves this key.
 *
 * Voyage was acquired by MongoDB, and the standalone dashboard no longer
 * issues keys — new ones are created in MongoDB Atlas and authenticate against
 * `ai.mongodb.com`, not `api.voyageai.com`. A key sent to the wrong host is
 * simply rejected, so this is not a detail that can be left to the caller.
 *
 * Atlas keys carry their scope in the prefix: `al-eu-…` and `al-us-…` work
 * *only* against their own geography's host, which is the whole point of
 * scoping them. Keys issued before geographies existed are unscoped `al-…`.
 * Anything else is a legacy `pa-…` key from voyageai.com, which still works
 * against the original host.
 *
 * `VOYAGE_BASE_URL` overrides all of it, for a proxy or a future host.
 */
export function embeddingsEndpoint(apiKey: string): string {
  const override = process.env.VOYAGE_BASE_URL?.trim()
  if (override) return `${override.replace(/\/+$/, '')}/embeddings`

  if (apiKey.startsWith('al-')) {
    const geography = /^al-(eu|us)-/.exec(apiKey)?.[1]
    return geography
      ? `https://${geography}.ai.mongodb.com/v1/embeddings`
      : 'https://ai.mongodb.com/v1/embeddings'
  }

  return 'https://api.voyageai.com/v1/embeddings'
}

/** Voyage caps a single request; batching keeps indexing within it. */
const MAX_BATCH = 64

export function embeddingsConfigured(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY?.trim())
}

export type EmbeddingInputType = 'document' | 'query'

/**
 * Embeds a batch of texts.
 *
 * `inputType` is not optional for a reason: Voyage prepends a different
 * instruction for documents and for queries, and mixing them measurably
 * degrades retrieval. Indexing passes `document`; searching passes `query`.
 *
 * Returns null when no key is configured, so callers degrade rather than throw.
 */
export async function embed(
  texts: string[],
  inputType: EmbeddingInputType
): Promise<number[][] | null> {
  const key = process.env.VOYAGE_API_KEY?.trim()
  if (!key) return null
  if (texts.length === 0) return []

  const out: number[][] = []

  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH)

    const response = await fetch(embeddingsEndpoint(key), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: batch,
        input_type: inputType,
        output_dimension: EMBEDDING_DIMENSIONS,
      }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      const hint =
        response.status === 401 || response.status === 403
          ? `（金鑰與端點必須配對：Atlas 的 al- 金鑰走 ai.mongodb.com，` +
            `voyageai.com 的 pa- 金鑰走 api.voyageai.com；` +
            `目前送往 ${embeddingsEndpoint(key)}）`
          : ''
      throw new Error(
        `Voyage 回應 ${response.status}：${detail.slice(0, 200) || '沒有內容'}${hint}`
      )
    }

    const body = (await response.json()) as {
      data?: { index: number; embedding: number[] }[]
    }

    const rows = body.data ?? []
    if (rows.length !== batch.length) {
      throw new Error(`Voyage 回傳 ${rows.length} 筆，但送出了 ${batch.length} 筆`)
    }

    // The API documents results in request order, but it also returns an
    // index; trusting the index costs nothing and survives a reorder.
    const ordered = [...rows].sort((a, b) => a.index - b.index)
    for (const row of ordered) {
      if (row.embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Voyage 回傳 ${row.embedding.length} 維，索引建立時是 ${EMBEDDING_DIMENSIONS} 維`
        )
      }
      out.push(row.embedding)
    }
  }

  return out
}

/** One text. Convenience for the query side, which always embeds exactly one. */
export async function embedOne(
  text: string,
  inputType: EmbeddingInputType
): Promise<number[] | null> {
  const result = await embed([text], inputType)
  return result?.[0] ?? null
}
