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

const ENDPOINT = 'https://api.voyageai.com/v1/embeddings'

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

    const response = await fetch(ENDPOINT, {
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
      throw new Error(
        `Voyage 回應 ${response.status}：${detail.slice(0, 200) || '沒有內容'}`
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
