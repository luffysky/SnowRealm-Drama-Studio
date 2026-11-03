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

/**
 * How long a call may spend waiting out a 429.
 *
 * A search has a user waiting on it, so it gives up almost immediately and
 * falls back to keyword matching. Indexing can afford to wait — but not past
 * Vercel Hobby's 60-second function limit, which is where 45s comes from.
 */
const QUERY_MAX_WAIT_MS = 2_000
const INDEX_MAX_WAIT_MS = 45_000

const MAX_ATTEMPTS = 5

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
  inputType: EmbeddingInputType,
  options: { maxWaitMs?: number } = {}
): Promise<number[][] | null> {
  const key = process.env.VOYAGE_API_KEY?.trim()
  if (!key) return null
  if (texts.length === 0) return []

  /*
   * How long this call may spend waiting out a 429 before giving up.
   *
   * The two sides want opposite things. A search must answer now, so it waits
   * barely at all and falls back to keyword matching. Indexing is worth
   * waiting for — on the free tier (3 requests per minute) the second batch
   * *will* be throttled, and failing the whole reindex over it would mean the
   * index could never be built at all.
   */
  const maxWaitMs = options.maxWaitMs ?? (inputType === 'query' ? QUERY_MAX_WAIT_MS : INDEX_MAX_WAIT_MS)

  const out: number[][] = []

  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH)

    const response = await requestWithRetry(
      embeddingsEndpoint(key),
      {
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
      },
      maxWaitMs
    )

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(describeFailure(response.status, detail, embeddingsEndpoint(key)))
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

/**
 * POST, retrying throttles and transient server errors.
 *
 * `retry-after` is honoured when the server sends it; otherwise the wait
 * doubles from one second, with jitter so two concurrent callers do not line
 * up and collide again. Returns the last response rather than throwing, so the
 * caller reports the real status.
 */
async function requestWithRetry(
  url: string,
  init: RequestInit,
  maxWaitMs: number
): Promise<Response> {
  let waited = 0

  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, init)

    const retryable = response.status === 429 || response.status >= 500
    if (!retryable || attempt >= MAX_ATTEMPTS) return response

    const header = Number(response.headers.get('retry-after'))
    const suggested =
      Number.isFinite(header) && header > 0
        ? header * 1000
        : 2 ** (attempt - 1) * 1000 + Math.random() * 250

    // Never start a wait that would overrun the budget: sleeping 20s only to
    // give up anyway wastes the caller's entire time slice.
    if (waited + suggested > maxWaitMs) return response

    // The body is not read on a retry; release it so the socket is reused.
    await response.body?.cancel().catch(() => {})

    await new Promise((resolve) => setTimeout(resolve, suggested))
    waited += suggested
  }
}

/** Turns a failed response into something actionable rather than a status code. */
function describeFailure(status: number, detail: string, endpoint: string): string {
  const body = detail.slice(0, 300) || '沒有內容'

  if (status === 401 || status === 403) {
    return (
      `Voyage 回應 ${status}：金鑰被拒。金鑰與端點必須配對——` +
      `Atlas 的 al- 金鑰走 ai.mongodb.com，voyageai.com 的 pa- 金鑰走 ` +
      `api.voyageai.com；目前送往 ${endpoint}。原文：${body}`
    )
  }

  if (status === 429) {
    return (
      `Voyage 回應 429：超過速率限制。未綁付款方式的帳號只有 3 RPM / 10K TPM，` +
      `重建一次索引就會用完當分鐘的額度。原文：${body}`
    )
  }

  return `Voyage 回應 ${status}：${body}`
}

/** One text. Convenience for the query side, which always embeds exactly one. */
export async function embedOne(
  text: string,
  inputType: EmbeddingInputType,
  options: { maxWaitMs?: number } = {}
): Promise<number[] | null> {
  const result = await embed([text], inputType, options)
  return result?.[0] ?? null
}
