import { deleteObject, getObjectBytes, putObject } from '@/lib/r2'
import { synthesize } from '@/lib/azure/speech'

/**
 * 把 SSML 真的變成聲音，而且中途斷掉接得回來 (Z129).
 *
 * 一集小說大約三十分鐘的音檔，而 worker 的函式上限是 **60 秒**
 * （`api/ai/worker/route.ts`）。所以不可能一次做完——這不是效能問題，是
 * 「永遠做不完」的問題。
 *
 * 做法是把它拆成很多小段，每一段做完就先存起來：
 *
 *   1. 每次被叫到，就在時間預算內盡量多做幾段
 *   2. 每做完一段，立刻上傳成一個暫存物件並記下來
 *   3. 下次被叫到，從還沒做的那一段繼續
 *   4. 全部做完才拼起來、存成正式素材、刪掉暫存
 *
 * 關鍵是**每一段做完就落地**。如果把做好的 bytes 留在記憶體裡等全部做完，
 * 函式一超時就全部重來——而且會重新付一次錢。
 *
 * 「哪一段還沒做」是純函式，所以可以測；而那正是最容易錯的地方——重複做一段
 * 是多花一次錢，跳過一段是聽到一半突然跳掉。
 */

export type RenderedPart = {
  /** Index into the SSML array. The order the parts are joined in. */
  index: number
  objectKey: string
  bytes: number
  /** Budgeted seconds of audio, for the progress note. */
  sec: number
}

/**
 * The next part to render, or null when every one is done.
 *
 * Works from what has **landed**, not from a counter: a counter and the
 * stored parts can disagree after a timeout, and the stored parts are the
 * ones that were paid for.
 */
export function nextPartIndex(total: number, done: RenderedPart[]): number | null {
  const have = new Set(done.map((part) => part.index))
  for (let index = 0; index < total; index += 1) {
    if (!have.has(index)) return index
  }
  return null
}

export function renderSummary(
  total: number,
  done: RenderedPart[]
): { done: number; total: number; percent: number; bytes: number; sec: number } {
  /*
   * Counted as distinct indices rather than array length. A part retried after
   * a timeout can be recorded twice, and 「43 / 42 段」 is the kind of progress
   * readout that makes everything else on the page look wrong too.
   */
  const unique = new Set(done.map((part) => part.index))
  const counted = done.filter(
    (part, at) => done.findIndex((other) => other.index === part.index) === at
  )

  return {
    done: unique.size,
    total,
    percent: total === 0 ? 0 : Math.round((unique.size / total) * 100),
    bytes: counted.reduce((sum, part) => sum + part.bytes, 0),
    sec: counted.reduce((sum, part) => sum + part.sec, 0),
  }
}

/** Where a part lives while the job is still running. */
export function partKey(jobId: string, index: number): string {
  return `tmp/tts/${jobId}/${String(index).padStart(4, '0')}.mp3`
}

export type RenderStep = {
  parts: RenderedPart[]
  complete: boolean
  /** Rendered in this call, for the log. */
  rendered: number
}

/**
 * Renders as many parts as fit in the budget.
 *
 * Stops **before** starting a part it does not have time for rather than
 * being cut off mid-request: a request killed by the function timeout is one
 * Azure has already billed and we have nothing to show for.
 */
export async function renderParts(input: {
  jobId: string
  ssml: string[]
  /** Seconds of audio each part is budgeted at, same order as `ssml`. */
  seconds: number[]
  done: RenderedPart[]
  budgetMs: number
  /** Called after each part lands, so progress is visible while it runs. */
  onPart?: (parts: RenderedPart[]) => Promise<void>
}): Promise<RenderStep> {
  const started = Date.now()
  const parts = [...input.done]
  let rendered = 0

  /** Measured from this run, so the guess improves as it goes. */
  let worstMs = 0

  for (;;) {
    const index = nextPartIndex(input.ssml.length, parts)
    if (index === null) break

    const elapsed = Date.now() - started
    /*
     * Reserve the longest part seen so far, plus a margin for the upload. On
     * the first part there is no measurement, so it always goes ahead — a
     * worker that renders nothing on its first call never starts at all.
     */
    const reserve = rendered === 0 ? 0 : worstMs + 2000
    if (elapsed + reserve > input.budgetMs) break

    const at = Date.now()
    const audio = await synthesize(input.ssml[index]!)
    const objectKey = partKey(input.jobId, index)

    await putObject({ objectKey, body: audio, contentType: 'audio/mpeg' })

    parts.push({
      index,
      objectKey,
      bytes: audio.length,
      sec: input.seconds[index] ?? 0,
    })
    rendered += 1
    worstMs = Math.max(worstMs, Date.now() - at)

    if (input.onPart) await input.onPart(parts)
  }

  return {
    parts,
    complete: nextPartIndex(input.ssml.length, parts) === null,
    rendered,
  }
}

/**
 * Stitches the parts into one file, in order.
 *
 * MP3 frames are self-contained, so concatenating them produces a file every
 * player will play. It is not a re-mux: the result carries the first part's
 * header, so a player reading the duration from it may show the wrong total
 * until it scans. That is a cosmetic flaw in a draft audiobook, and the
 * alternative — pulling in an encoder — is a native dependency on a
 * serverless runtime.
 */
export async function joinParts(parts: RenderedPart[]): Promise<Buffer> {
  const ordered = [...parts].sort((a, b) => a.index - b.index)
  const buffers: Buffer[] = []

  for (const part of ordered) {
    const bytes = await getObjectBytes(part.objectKey)
    if (!bytes) {
      throw new Error(`第 ${part.index + 1} 段的暫存檔不見了，請重新產生這一集`)
    }
    buffers.push(bytes)
  }

  return Buffer.concat(buffers)
}

/**
 * Removes the temporary parts.
 *
 * Never throws: the audio is already saved by the time this runs, and failing
 * the job over leftover scratch files would discard work that succeeded. The
 * strays are swept by `scripts/purge-stale-uploads.ts`.
 */
export async function discardParts(parts: RenderedPart[]): Promise<void> {
  await Promise.all(
    parts.map(async (part) => {
      try {
        await deleteObject(part.objectKey)
      } catch {
        /* Swept later. */
      }
    })
  )
}
