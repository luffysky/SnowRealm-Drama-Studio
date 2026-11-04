import type { CastedChunk } from '@/lib/narration'
import { markReadings, spell } from './pronounce'

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
const AZURE_CEILING_SEC = 8 * 60

/**
 * 真正在管事的不是 Azure 的上限，是我們自己的函式上限。
 *
 * The worker runs with `maxDuration = 60` (`api/ai/worker/route.ts`), so a
 * part has to be sized for **our** budget, not Azure's. That is also what
 * makes the whole thing resumable: a job of many small parts can stop after
 * any of them and pick up where it left off; a job of four big ones cannot.
 *
 * **Measured**, now, rather than guessed: 35 characters of multi-voice SSML
 * came back in 1.3 seconds — about **seven times real time**. The first
 * version of this assumed the worst case of 1× and sat at 45 seconds, which
 * would have made an episode 42 round trips for no reason.
 *
 * At 7× a two-minute part synthesises in roughly 17 seconds, so three fit in
 * one invocation with room to spare. Not pushed further: the cost of a part
 * that overruns is a request Azure has already billed and we have nothing to
 * show for, while the cost of a part that is too small is one more HTTP
 * round trip. Those are not symmetrical.
 */
const FUNCTION_BUDGET_SEC = 120

const MAX_SECONDS_PER_REQUEST = Math.min(AZURE_CEILING_SEC, FUNCTION_BUDGET_SEC)

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
 * 屬性值。
 *
 * 跟 `escapeXml` 分開一支，因為屬性裡**必須**處理引號而文字節點裡不必。
 * 這裡的值是我們自己字典裡的注音與拼音，本來就不含引號——但「本來就不含」
 * 是一句關於今天的話，而這個函式要對明天新增的規則也成立。
 */
function escapeAttr(value: string): string {
  return escapeXml(value).replaceAll('"', '&quot;')
}

/**
 * 一塊文字，該標讀音的地方標上 (Z140).
 *
 * 用哪一種拼寫是**音色**決定的，不是文件的 `xml:lang`——所以只有到這裡、
 * 知道最後是哪一個音色在唸，才能決定。`spell()` 回 null 就是那一類音色不
 * 支援（粵語、吳語、多語言，實測一律 400），原樣輸出。
 *
 * 寧可唸錯一個字，也不要送出一個會被整批退掉的請求。
 */
function renderText(text: string, voice: string): string {
  const out: string[] = []

  for (const segment of markReadings(text)) {
    const ph = segment.reading ? spell(segment.reading, voice) : null
    if (!ph) {
      out.push(escapeXml(segment.text))
      continue
    }
    out.push(`<phoneme alphabet="sapi" ph="${escapeAttr(ph)}">${escapeXml(segment.text)}</phoneme>`)
  }

  return out.join('')
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
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
      `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${options.locale}">`,
  ]

  /*
   * 三層，而且順序是 Azure 定的：`<voice>` 包 `<mstts:express-as>` 包
   * `<prosody>`。情緒風格換了就得連裡面的 prosody 一起收掉再重開，所以
   * 收的動作是**由內往外串**的——漏掉一層就是標籤交錯，而交錯的 SSML 是
   * 400，整批白跑。
   */
  let openVoice: string | null = null
  /** null 代表沒有開著 express-as；有值就是正開著的風格。 */
  let openStyle: string | null = null
  let openProsody: string | null = null

  const closeProsody = () => {
    if (openProsody !== null) parts.push('</prosody>')
    openProsody = null
  }

  const closeStyle = () => {
    closeProsody()
    if (openStyle !== null) parts.push('</mstts:express-as>')
    openStyle = null
  }

  const closeVoice = () => {
    closeStyle()
    if (openVoice !== null) parts.push('</voice>')
    openVoice = null
  }

  for (const chunk of chunks) {
    const text = chunk.text.trim()

    /*
     * 場景分隔：一段靜音，不是一個字 (Z140).
     *
     * `<break>` 要待在 `<voice>` 裡面——`<speak>` 底下直接放，Azure 不收。
     * 所以沒有開著的音色時，借旁白的開一個。
     */
    if (!text) {
      if (chunk.pauseMs && chunk.pauseMs > 0) {
        if (openVoice === null) {
          parts.push(`<voice name="${options.narratorVoice}">`)
          openVoice = options.narratorVoice
        }
        parts.push(`<break time="${Math.round(chunk.pauseMs)}ms"/>`)
      }
      continue
    }

    const voice = chunk.voiceId || options.narratorVoice
    const style = chunk.style?.trim() || null
    const rate = prosodyPercent(chunk.rate ?? 1, RATE_BOUND)
    const pitch = prosodyPercent(chunk.pitch ?? 1, PITCH_BOUND)
    const prosody = `${rate}|${pitch}`

    if (voice !== openVoice) {
      closeVoice()
      parts.push(`<voice name="${voice}">`)
      openVoice = voice
    }

    if (style !== openStyle) {
      closeStyle()
      if (style) {
        parts.push(`<mstts:express-as style="${escapeAttr(style)}">`)
        openStyle = style
      }
    }

    if (prosody !== openProsody) {
      closeProsody()
      parts.push(`<prosody rate="${rate}" pitch="${pitch}">`)
      openProsody = prosody
    }

    parts.push(renderText(text, voice))

    /*
     * A beat between paragraphs. Without it every paragraph runs into the
     * next, because the chunks were split for a highlight to follow, not for
     * somebody to listen to.
     */
    parts.push('<break strength="medium"/>')
  }

  closeVoice()
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

    /*
     * 空白的一塊通常就是沒東西，丟掉；但帶著 `pauseMs` 的那種是**場景分隔的
     * 靜音**，丟掉它就等於把場景之間的停頓又拿掉了——而那正是加它的理由。
     */
    if (length === 0 && !chunk.pauseMs) continue

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
  AZURE_CEILING_SEC,
  FUNCTION_BUDGET_SEC,
} as const
