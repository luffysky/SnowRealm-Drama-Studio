import type { LyricLine } from '@/lib/lyrics'

/**
 * 用聽的幫歌詞標時間 (Z131).
 *
 * 「有辦法做一個用聽的就可以標記時間的 AI 輔助器嗎」。有，而且不必再接一家
 * 供應商：Azure Speech 的同一把金鑰既能做文字轉語音（Z129），也能把整首歌
 * 轉成**帶逐字時間**的文字。
 *
 * 但直接拿辨識結果當歌詞是不行的。唱歌跟講話差很多——有伴奏、有拖長的母音、
 * 一個字唱三拍——辨識出來的字會錯一堆。所以這裡做的是**對齊**而不是辨識：
 *
 *   1. Azure 轉錄整首歌 → 一串「字 + 時間」。
 *   2. 你**已經有**正確的歌詞。
 *   3. 把這兩串字做序列對齊，把時間搬到正確的字上。
 *
 * 關鍵在於，就算它把「三文錢」聽成「山紋前」，那三個字在**序列中的位置**
 * 還是對的，所以時間照樣落在正確的那一句上。錯字不影響時間，這就是為什麼
 * 對齊比辨識可靠得多。
 *
 * 這整個檔案沒有網路。對齊對不對是「聽到歌放一半才發現」的錯——跟 SSML
 * 那層同一個理由，能用測試問的就不要用耳朵問。
 */

/** One recognised token from the speech service. */
export type RecognisedWord = {
  text: string
  startMs: number
  durationMs: number
}

export type AlignedLine = {
  /** Proposed start, or null when nothing in the line could be matched. */
  timeMs: number | null
  text: string
  /**
   * 0–1: the fraction of this line's characters that matched the audio.
   *
   * Shown rather than thresholded away. A line at 0.2 is probably right and
   * worth checking; silently dropping it would leave a hole the person has to
   * find, and silently keeping it without saying so is worse.
   */
  confidence: number
  /**
   * Where the time came from.
   *
   * `interpolated` means nothing in the line matched and the time was spread
   * between the neighbours that did. It is a guess, it is labelled as one,
   * and the editor shows it differently.
   */
  source: 'matched' | 'interpolated' | 'none'
}

export type AlignmentResult = {
  lines: AlignedLine[]
  /** Share of lyric characters that found a home in the audio. */
  coverage: number
  /** What the recogniser thought it heard, for 「它到底聽到什麼」. */
  heard: string
}

/* -------------------------------------------------------------------------- */

/**
 * Characters worth matching on.
 *
 * Punctuation, spaces and the 「」 that make up half of this novel's prose
 * carry no sound, so they would be pure noise in an alignment. Latin letters
 * are lower-cased; CJK needs no case folding.
 */
function significant(char: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}a-z0-9]/u.test(
    char
  )
}

function normalise(text: string): string {
  return [...text.toLowerCase()].filter(significant).join('')
}

/** A lyric character with the line it came from. */
type LyricChar = { char: string; line: number }

/** A recognised character with the moment it was heard. */
type HeardChar = { char: string; timeMs: number }

/**
 * Spreads a word's duration across its characters.
 *
 * Azure returns a time per recognised token. For Chinese a token is often
 * several characters, and a line boundary can fall inside one — so each
 * character gets its own share rather than all of them claiming the word's
 * start. The error this removes is up to a whole word, which at singing pace
 * is most of a second.
 */
function explode(words: RecognisedWord[]): HeardChar[] {
  const out: HeardChar[] = []

  for (const word of words) {
    const chars = [...normalise(word.text)]
    if (chars.length === 0) continue

    const step = chars.length > 1 ? word.durationMs / chars.length : 0
    chars.forEach((char, index) => {
      out.push({ char, timeMs: Math.round(word.startMs + step * index) })
    })
  }

  return out
}

function explodeLyrics(lines: LyricLine[]): LyricChar[] {
  const out: LyricChar[] = []

  lines.forEach((line, index) => {
    for (const char of normalise(line.text)) out.push({ char, line: index })
  })

  return out
}

/* -------------------------------------------------------------------------- */

/** Scores for the alignment. Mismatches are allowed; skipping is cheap. */
const MATCH = 2
const MISMATCH = -1
const GAP = -1

/**
 * Beyond this many characters on either side, the full matrix is too big to
 * build. A five-minute song is well under it; this is a guard, not a budget.
 */
const MAX_CHARS = 6000

/**
 * Matched characters a line needs before its timestamp is believed.
 *
 * A line that matched in full is always believed, however short — see where
 * this is used.
 */
const MIN_MATCHED_CHARS = 2

/**
 * Needleman–Wunsch over the two character streams.
 *
 * Global rather than local alignment, because both sides are the *whole* song:
 * the lyrics are complete and the transcript covers the same audio. A local
 * aligner would happily match only the chorus and call it done.
 *
 * Monotonic by construction, which is the property that matters most here —
 * timings that go backwards are worse than timings that are missing.
 *
 * Returns, for each lyric character index, the millisecond it was heard at,
 * or -1 where it matched nothing.
 */
function align(lyrics: LyricChar[], heard: HeardChar[]): number[] {
  const n = lyrics.length
  const m = heard.length
  const times = new Array<number>(n).fill(-1)

  if (n === 0 || m === 0 || n > MAX_CHARS || m > MAX_CHARS) return times

  /*
   * One flat Int32Array rather than nested arrays: a 2,000 × 2,000 song is
   * four million cells, and four million small arrays is how this becomes
   * slow enough to notice.
   */
  const width = m + 1
  const score = new Int32Array((n + 1) * width)

  for (let i = 1; i <= n; i += 1) score[i * width] = i * GAP
  for (let j = 1; j <= m; j += 1) score[j] = j * GAP

  for (let i = 1; i <= n; i += 1) {
    const lyricChar = lyrics[i - 1]!.char
    const row = i * width
    const previousRow = row - width

    for (let j = 1; j <= m; j += 1) {
      const diagonal =
        score[previousRow + j - 1]! + (lyricChar === heard[j - 1]!.char ? MATCH : MISMATCH)
      const up = score[previousRow + j]! + GAP
      const left = score[row + j - 1]! + GAP

      score[row + j] = Math.max(diagonal, up, left)
    }
  }

  // Trace back, keeping only the positions that actually matched.
  let i = n
  let j = m

  while (i > 0 && j > 0) {
    const lyricChar = lyrics[i - 1]!.char
    const heardChar = heard[j - 1]!
    const diagonal =
      score[(i - 1) * width + j - 1]! + (lyricChar === heardChar.char ? MATCH : MISMATCH)

    if (score[i * width + j] === diagonal) {
      if (lyricChar === heardChar.char) times[i - 1] = heardChar.timeMs
      i -= 1
      j -= 1
    } else if (score[i * width + j] === score[(i - 1) * width + j]! + GAP) {
      i -= 1
    } else {
      j -= 1
    }
  }

  return times
}

/* -------------------------------------------------------------------------- */

/**
 * Proposes a timestamp for every line.
 *
 * Nothing here is authoritative. The result goes into the tap-to-sync editor
 * as a starting point, with its confidence visible, because singing is hard
 * for a recogniser and the person listening is the one who decides.
 */
export function alignLyrics(
  lines: LyricLine[],
  words: RecognisedWord[]
): AlignmentResult {
  const lyricChars = explodeLyrics(lines)
  const heardChars = explode(words)
  const times = align(lyricChars, heardChars)

  /** Per line: the earliest matched time, and how much of it matched. */
  const earliest = new Map<number, number>()
  const matched = new Map<number, number>()
  const total = new Map<number, number>()

  lyricChars.forEach((entry, index) => {
    total.set(entry.line, (total.get(entry.line) ?? 0) + 1)

    const time = times[index]!
    if (time < 0) return

    matched.set(entry.line, (matched.get(entry.line) ?? 0) + 1)
    const current = earliest.get(entry.line)
    if (current === undefined || time < current) earliest.set(entry.line, time)
  })

  const aligned: AlignedLine[] = lines.map((line, index) => {
    const hits = matched.get(index) ?? 0
    const size = total.get(index) ?? 0
    const time = earliest.get(index)

    /*
     * 一個字對上不算對上.
     *
     * Found by a test: 「完全沒聽到的一句」 shares its last 「句」 with a line
     * the recogniser *did* hear, and that single character was enough to hand
     * the line a timestamp that looked as solid as any other. One character
     * out of eight is a coincidence, not a match — Chinese has a few hundred
     * common characters and a song repeats most of them.
     *
     * So a line is only trusted on two or more matched characters, unless it
     * matched **entirely** — which is how 「甲」 and other one-character lines
     * still count.
     */
    const trusted = time !== undefined && (hits >= MIN_MATCHED_CHARS || hits === size)

    return {
      text: line.text,
      timeMs: trusted ? time! : null,
      confidence: size === 0 ? 0 : hits / size,
      source: trusted ? 'matched' : 'none',
    }
  })

  /*
   * 沒對上的那幾句，夾在前後之間.
   *
   * A line the recogniser missed entirely — an instrumental cue, a line
   * buried under the backing, a 「啦啦啦」 — leaves a hole in the middle of an
   * otherwise timed sheet, which the person then has to go and find. Spacing
   * it evenly between its neighbours is a guess, so it is **labelled** as one
   * and the editor shows it differently. Only ever between two matched lines:
   * guessing past the ends would put a line before the song starts.
   */
  interpolate(aligned)

  /* Monotonic, always. A sheet that jumps backwards is worse than a gap. */
  enforceOrder(aligned)

  const matchedChars = [...matched.values()].reduce((a, b) => a + b, 0)

  return {
    lines: aligned,
    coverage: lyricChars.length === 0 ? 0 : matchedChars / lyricChars.length,
    heard: words.map((word) => word.text).join(''),
  }
}

function interpolate(lines: AlignedLine[]): void {
  let index = 0

  while (index < lines.length) {
    if (lines[index]!.timeMs !== null) {
      index += 1
      continue
    }

    const start = index
    let end = index
    while (end < lines.length && lines[end]!.timeMs === null) end += 1

    const before = start > 0 ? lines[start - 1]!.timeMs : null
    const after = end < lines.length ? lines[end]!.timeMs : null

    if (before !== null && after !== null && after > before) {
      const gap = (after - before) / (end - start + 1)
      for (let k = start; k < end; k += 1) {
        lines[k] = {
          ...lines[k]!,
          timeMs: Math.round(before + gap * (k - start + 1)),
          source: 'interpolated',
        }
      }
    }

    index = end + 1
  }
}

/**
 * Keeps the sheet moving forward.
 *
 * The aligner is monotonic, but interpolation and a line whose only match was
 * a stray hit elsewhere in the song can still produce a step backwards. A
 * timestamp earlier than the line above it is always wrong, so it is dropped
 * rather than shown — a missing time is a line you tap; a backwards one is a
 * sheet that jumps while you read it.
 */
function enforceOrder(lines: AlignedLine[]): void {
  let last = -1

  for (let index = 0; index < lines.length; index += 1) {
    const time = lines[index]!.timeMs
    if (time === null) continue

    if (time < last) {
      lines[index] = { ...lines[index]!, timeMs: null, source: 'none' }
      continue
    }
    last = time
  }
}
