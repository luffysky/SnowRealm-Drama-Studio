import type { CastedChunk } from '@/lib/narration'

/**
 * 把分配好角色的段落變成 Azure 吃得下的 SSML (Z129).
 *
 * 有聲小說要能匯出檔案，就一定得走伺服器端 TTS——瀏覽器的 Web Speech API
 * 只會發聲，Chrome 沒有提供任何 MediaStream 可以錄下來。
 *
 * This file is the part of that with no network in it, deliberately: the SSML
 * is where multi-voice narration is either right or silently wrong, and
 * finding that out by listening to a 31-minute file is the worst possible
 * feedback loop. Everything here is a pure function with tests.
 *
 * What it reuses rather than reinvents: `narration.ts` already decides who is
 * speaking each paragraph and what tone it is in, and already hands each
 * character a voice deterministically — built for the browser voices, but
 * `assignVoices` takes any `{ id, lang }[]`, and Azure's voice list is
 * exactly that shape. So the cast assignment is the same code on both sides,
 * which is what stops 沈知味 sounding like one person in the reader and
 * another in the export.
 */

/**
 * Azure's real-time endpoint caps a single request's **output** at ten
 * minutes of audio. Budgeted at eight, because the estimate below is a
 * measurement of reading speed, not a guarantee, and a request that overruns
 * is a failed request rather than a slightly long one.
 */
const MAX_SECONDS_PER_REQUEST = 8 * 60

/**
 * Characters of Chinese prose per second, measured: 70 characters took 18.3
 * seconds in Chrome's speech synthesis (`src/lib/speech.ts`). Azure at
 * `rate="+0%"` is close enough to use the same figure for budgeting.
 */
const CHARS_PER_SEC = 3.9

/** Hard ceiling on one request's SSML, well inside Azure's body limit. */
const MAX_CHARS_PER_REQUEST = Math.floor(MAX_SECONDS_PER_REQUEST * CHARS_PER_SEC)

/**
 * `&`, `<` and `>` only.
 *
 * Quotes are left alone on purpose: they appear in text nodes, never in the
 * attributes this builds, and 「」『』 are most of this novel's punctuation —
 * escaping them would fill the SSML with entities for no reason.
 */
export function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * `narration.ts` speaks in multipliers (1.05 = five percent faster); Azure
 * speaks in signed percentages. Clamped to what Azure accepts rather than
 * sent and rejected: a 400 on request nine of forty is a wasted run, and the
 * tone shapes never go near these bounds anyway.
 */
export function prosodyPercent(multiplier: number, bound: number): string {
  if (!Number.isFinite(multiplier)) return '+0%'
  const percent = Math.round((multiplier - 1) * 100)
  const clamped = Math.max(-bound, Math.min(bound, percent))
  return `${clamped >= 0 ? '+' : ''}${clamped}%`
}

/** Azure's accepted ranges, as percentages either side of the default. */
const RATE_BOUND = 100
const PITCH_BOUND = 50

export type SsmlOptions = {
  /** `xml:lang` for the document, e.g. `zh-TW`. */
  locale: string
  /** Voice for anything with no character attached — the narrator. */
  narratorVoice: string
}

/**
 * One SSML document for a run of chunks.
 *
 * Azure allows several `<voice>` elements in one document, which is what
 * makes multi-character narration a single request rather than one request
 * per paragraph stitched together afterwards. Consecutive chunks sharing a
 * voice **and** a prosody are merged into one element: a chapter is mostly
 * narration, and emitting 238 identical wrappers makes the document several
 * times the size of the prose for no audible difference.
 */
export function ssmlFor(chunks: CastedChunk[], options: SsmlOptions): string {
  const parts: string[] = [
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${options.locale}">`,
  ]

  let openVoice: string | null = null
  let openProsody: string | null = null

  const closeAll = () => {
    if (openProsody !== null) parts.push('</prosody>')
    if (openVoice !== null) parts.push('</voice>')
    openProsody = null
    openVoice = null
  }

  for (const chunk of chunks) {
    const text = chunk.text.trim()
    if (!text) continue

    const voice = chunk.voiceId || options.narratorVoice
    const rate = prosodyPercent(chunk.rate ?? 1, RATE_BOUND)
    const pitch = prosodyPercent(chunk.pitch ?? 1, PITCH_BOUND)
    const prosody = `${rate}|${pitch}`

    if (voice !== openVoice) {
      closeAll()
      parts.push(`<voice name="${voice}">`)
      openVoice = voice
    }

    if (prosody !== openProsody) {
      if (openProsody !== null) parts.push('</prosody>')
      parts.push(`<prosody rate="${rate}" pitch="${pitch}">`)
      openProsody = prosody
    }

    parts.push(escapeXml(text))

    /*
     * A beat between paragraphs. Without it every paragraph runs into the
     * next, because the chunks were split for a highlight to follow, not for
     * somebody to listen to.
     */
    parts.push('<break strength="medium"/>')
  }

  closeAll()
  parts.push('</speak>')

  return parts.join('')
}

export type SsmlBatch = {
  chunks: CastedChunk[]
  chars: number
  /** Budgeted audio length, for the progress note and the cost estimate. */
  estimatedSec: number
}

/**
 * Splits an episode into requests that each stay inside Azure's limits.
 *
 * Splits **between** chunks, never inside one: a chunk is at most forty
 * characters and already respects paragraph boundaries, so cutting one in
 * half would put a join in the middle of a sentence. The only way a single
 * batch exceeds the cap is a single chunk that does, which cannot happen
 * while `splitForSpeech` caps them at forty.
 */
export function batchChunks(
  chunks: CastedChunk[],
  maxChars = MAX_CHARS_PER_REQUEST
): SsmlBatch[] {
  const batches: SsmlBatch[] = []
  let current: CastedChunk[] = []
  let chars = 0

  const flush = () => {
    if (current.length === 0) return
    batches.push({ chunks: current, chars, estimatedSec: chars / CHARS_PER_SEC })
    current = []
    chars = 0
  }

  for (const chunk of chunks) {
    const length = chunk.text.trim().length
    if (length === 0) continue

    if (chars > 0 && chars + length > maxChars) flush()

    current.push(chunk)
    chars += length
  }

  flush()
  return batches
}

/**
 * Billable characters.
 *
 * Azure bills the **text**, not the markup: tags, attributes and the
 * `<break/>` elements are not charged. So this counts what goes inside the
 * elements, which is the only number that should ever appear next to a price
 * in the UI.
 */
export function billableChars(chunks: CastedChunk[]): number {
  return chunks.reduce((total, chunk) => total + chunk.text.trim().length, 0)
}

/** Budgeted audio length for a whole episode, in seconds. */
export function estimatedSeconds(chunks: CastedChunk[]): number {
  return billableChars(chunks) / CHARS_PER_SEC
}

export const TTS_LIMITS = {
  MAX_SECONDS_PER_REQUEST,
  MAX_CHARS_PER_REQUEST,
  CHARS_PER_SEC,
} as const
