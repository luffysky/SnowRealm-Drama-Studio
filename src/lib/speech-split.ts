/**
 * 把正文切成一段一段唸得出來的單位。
 *
 * 從 `speech.ts` 抽出來的，因為那個檔案是 `'use client'` 而且用
 * `window.speechSynthesis`——伺服器端匯出有聲小說（Z129）載不進去。
 *
 * **但切法必須兩邊共用。** 閱讀器的角色配音跟匯出的音檔如果用不同的切法，
 * 同一個角色在兩邊會在不同的地方開口、用不同的語氣——那是會讓人以為是
 * 「匯出壞掉了」的那種不一致。所以切段住在這裡，兩邊都 import 這一份。
 *
 * 純函式，沒有瀏覽器、沒有資料庫。
 */

export type SpeechChunk = {
  text: string
  /**
   * Whose line this is, and how it sounds (Z111).
   *
   * All optional: without a cast every chunk is narration, which is exactly
   * what this was before. `rate` and `pitch` are **multipliers** on whatever
   * the reader has set, so someone who reads at 1.4x keeps their pace and
   * still hears a raised voice as raised.
   */
  voiceId?: string | null
  rate?: number
  pitch?: number
  /** The character's name, for showing who is speaking. */
  speaker?: string | null
  /**
   * Which paragraph this came from.
   *
   * Carried explicitly because the reader highlights the paragraph being
   * spoken. It used to assume one chunk per paragraph and highlight by chunk
   * index — true only while every paragraph fits in one utterance, and
   * silently wrong from the first long paragraph onward, with the highlight
   * drifting further behind for the rest of the chapter.
   */
  paragraph: number
}

/**
 * Roughly 40 characters.
 *
 * Measured in Chrome: 70 characters of Chinese took 18.3 seconds, so about
 * 3.9 characters a second. 40 keeps an utterance near ten seconds — under
 * Chrome's fifteen-second cut-off with room to spare, so the cut-off never
 * has to be worked around.
 */
const MAX_CHARS = 40

/**
 * Splits prose into utterances, one paragraph at a time.
 *
 * Paragraphs are never merged. A chapter of this novel is 238 paragraphs with
 * a median of 12 characters — mostly dialogue — and merging them would read
 * more smoothly but would make the highlight coarser than the line you are
 * looking at.
 */
export function splitForSpeech(paragraphs: string[], maxChars = MAX_CHARS): SpeechChunk[] {
  const out: SpeechChunk[] = []

  paragraphs.forEach((paragraph, index) => {
    const sentences = paragraph
      // Keep the punctuation: it is what makes the synthesiser pause.
      .split(/(?<=[。！？!?；;…，、：])/)
      .map((s) => s.trim())
      .filter(Boolean)

    let buffer = ''

    const flush = () => {
      if (buffer) out.push({ text: buffer, paragraph: index })
      buffer = ''
    }

    for (const sentence of sentences) {
      if (buffer && buffer.length + sentence.length > maxChars) flush()

      /*
       * A single sentence longer than the cap — one unbroken clause — is cut
       * on length. Ugly, but better than one 40-second utterance, which is
       * exactly where the browser stops speaking without telling anyone.
       */
      if (sentence.length > maxChars) {
        flush()
        for (let at = 0; at < sentence.length; at += maxChars) {
          out.push({ text: sentence.slice(at, at + maxChars), paragraph: index })
        }
        continue
      }

      buffer += sentence
    }

    flush()
  })

  return out
}

