/**
 * 歌詞：貼上、上傳、跟著歌走 (Z125).
 *
 * 「歌詞有辦法跟著歌曲走嗎 播到哪歌詞走到哪」。可以——但只有在歌詞帶著時間
 * 碼的時候。純文字的歌詞只能整段顯示，這是格式的限制，不是功能沒做。
 *
 * 所以這裡處理的是 LRC：每一行前面掛 `[mm:ss.xx]`。它是卡拉 OK 跟音樂播放器
 * 通用了二十幾年的格式，匯入匯出都接得上外面的工具，而且**是純文字**——出了
 * 任何問題都看得懂、改得動，不像自訂的 JSON 結構只有這個 app 讀得懂。
 *
 * 這個檔案不碰資料庫也不碰播放器，全是純函式。歌詞對不對時間，是那種「聽到
 * 歌放一半才發現」的錯；能用測試問的，就不該用耳朵問。
 */

export type LyricLine = {
  /** Milliseconds into the track, or null for a line with no timestamp. */
  timeMs: number | null
  text: string
}

export type LyricMeta = {
  title?: string
  artist?: string
  album?: string
  /** Who made the timings. */
  by?: string
  /**
   * Milliseconds of global adjustment, as written in the file.
   *
   * The LRC convention is that a **positive** offset shifts the lyrics
   * *earlier*, so the effective time is `timeMs - offset`. That is already
   * applied by {@link parseLrc}, so nothing downstream has to remember which
   * way round it goes — the sign is the single most commonly mixed-up part of
   * this format.
   */
  offsetMs?: number
}

export type Lyrics = {
  lines: LyricLine[]
  meta: LyricMeta
  /** Whether any line carries a timestamp — i.e. whether it can follow along. */
  timed: boolean
}

/** `[mm:ss]`, `[mm:ss.xx]` or `[mm:ss.xxx]`. Minutes may exceed 59. */
const TIME_TAG = /\[(\d{1,4}):([0-5]?\d)(?:[.:](\d{1,3}))?\]/g

/** `[ti:…]`, `[ar:…]`, `[al:…]`, `[by:…]`, `[offset:…]`, `[length:…]`. */
const META_TAG = /^\[(ti|ar|al|by|offset|length|re|ve):(.*)\]$/i

/**
 * Word-level timings from Enhanced LRC, e.g. `<00:12.34>`.
 *
 * Stripped rather than kept: following a line is what was asked for, and
 * keeping per-word marks would mean a highlight that moves inside a line
 * while nothing on screen uses it. They are dropped from the **text**, so a
 * file carrying them still reads correctly.
 */
const WORD_TAG = /<\d{1,4}:[0-5]?\d(?:[.:]\d{1,3})?>/g

/**
 * Centiseconds vs milliseconds: `[01:02.5]` is 500ms, `[01:02.50]` is 500ms,
 * `[01:02.500]` is 500ms. Two digits is the common case and means hundredths.
 */
function fractionToMs(digits: string | undefined): number {
  if (!digits) return 0
  const padded = digits.padEnd(3, '0').slice(0, 3)
  return Number(padded)
}

/** True when the text looks like LRC — at least one line starts with a time tag. */
export function isLrc(text: string): boolean {
  return text
    .split(/\r?\n/)
    .some((line) => /^\s*\[\d{1,4}:[0-5]?\d(?:[.:]\d{1,3})?\]/.test(line))
}

/**
 * Parses LRC, or plain text as untimed lines.
 *
 * Never throws and never discards words. A file with one malformed line
 * should show that line without a time rather than fail to load — the lyrics
 * are the point, the timings are the enhancement.
 */
export function parseLrc(text: string): Lyrics {
  const meta: LyricMeta = {}
  const lines: LyricLine[] = []

  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    const metaMatch = META_TAG.exec(trimmed)
    if (metaMatch) {
      const key = (metaMatch[1] ?? '').toLowerCase()
      const value = (metaMatch[2] ?? '').trim()

      if (key === 'ti') meta.title = value
      else if (key === 'ar') meta.artist = value
      else if (key === 'al') meta.album = value
      else if (key === 'by') meta.by = value
      else if (key === 'offset') {
        const parsed = Number.parseInt(value, 10)
        if (Number.isFinite(parsed)) meta.offsetMs = parsed
      }
      continue
    }

    /*
     * Every time tag on the line, not just the first. A chorus is written
     * once with several timestamps — `[00:42.10][02:15.30]副歌` — and taking
     * only the first makes it play once and never come back.
     */
    TIME_TAG.lastIndex = 0
    const stamps: number[] = []
    let match: RegExpExecArray | null
    let consumed = 0

    while ((match = TIME_TAG.exec(trimmed)) !== null) {
      // Only the run of tags at the start of the line. A timestamp written
      // mid-sentence is part of the words, not a cue.
      if (match.index !== consumed) break
      consumed = match.index + match[0].length

      const minutes = Number(match[1])
      const seconds = Number(match[2])
      stamps.push(minutes * 60_000 + seconds * 1000 + fractionToMs(match[3]))
    }

    const body = trimmed.slice(consumed).replace(WORD_TAG, '').trim()

    if (stamps.length === 0) {
      lines.push({ timeMs: null, text: body })
      continue
    }

    for (const timeMs of stamps) lines.push({ timeMs, text: body })
  }

  /*
   * Applied here, once, so nothing downstream has to know which direction a
   * positive offset means. Clamped at zero: a line cannot play before the
   * track starts, and a negative time would sort ahead of everything.
   */
  const offset = meta.offsetMs ?? 0
  if (offset !== 0) {
    for (const line of lines) {
      if (line.timeMs !== null) line.timeMs = Math.max(0, line.timeMs - offset)
    }
  }

  /*
   * Sorted by time, with untimed lines keeping their place relative to the
   * line before them. A chorus repeated by a second timestamp arrives out of
   * order in the file, and a lyric sheet that jumps backwards is worse than
   * one that does not move at all.
   */
  const timed = lines.some((line) => line.timeMs !== null)
  if (timed) {
    lines.sort((a, b) => {
      if (a.timeMs === null) return 1
      if (b.timeMs === null) return -1
      return a.timeMs - b.timeMs
    })
  }

  return { lines, meta, timed }
}

/** Plain text, one line per line, for lyrics nobody has timed yet. */
export function parsePlain(text: string): Lyrics {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ timeMs: null, text: line }))

  return { lines, meta: {}, timed: false }
}

/** Whichever the text is. */
export function parseLyrics(text: string): Lyrics {
  return isLrc(text) ? parseLrc(text) : parsePlain(text)
}

/** `mm:ss.xx`, the way LRC writes it. */
export function formatLrcTime(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const minutes = Math.floor(total / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const centis = Math.floor((total % 1000) / 10)

  return (
    `${String(minutes).padStart(2, '0')}:` +
    `${String(seconds).padStart(2, '0')}.` +
    `${String(centis).padStart(2, '0')}`
  )
}

/**
 * Back to a `.lrc` file.
 *
 * The offset is deliberately **not** written back: `parseLrc` already folded
 * it into every timestamp, so writing it again would apply it twice. The
 * round trip is lossless in effect even though it is not byte-identical.
 */
export function toLrc(lyrics: Lyrics): string {
  const out: string[] = []

  if (lyrics.meta.title) out.push(`[ti:${lyrics.meta.title}]`)
  if (lyrics.meta.artist) out.push(`[ar:${lyrics.meta.artist}]`)
  if (lyrics.meta.album) out.push(`[al:${lyrics.meta.album}]`)
  if (lyrics.meta.by) out.push(`[by:${lyrics.meta.by}]`)

  for (const line of lyrics.lines) {
    out.push(line.timeMs === null ? line.text : `[${formatLrcTime(line.timeMs)}]${line.text}`)
  }

  return out.join('\n')
}

/**
 * Which line is playing at `seconds`.
 *
 * Returns the index of the last line whose timestamp has passed, or -1 before
 * the first one. Binary search rather than a scan: this runs on every
 * `timeupdate`, which fires several times a second for the length of a song.
 *
 * Untimed lines are skipped rather than treated as time 0 — a file with a
 * title line above the first cue must not highlight the title for the whole
 * intro.
 */
export function lineAt(lines: LyricLine[], seconds: number): number {
  const ms = seconds * 1000

  let low = 0
  let high = lines.length - 1
  let found = -1

  while (low <= high) {
    const mid = (low + high) >> 1
    const time = lines[mid]?.timeMs

    if (time === null || time === undefined) {
      // Untimed lines sort to the end, so everything past here is untimed.
      high = mid - 1
      continue
    }

    if (time <= ms) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return found
}

/**
 * Stamps the current time onto one line — 「邊聽邊點」.
 *
 *手打時間碼沒人受得了，所以做成播放時每句按一下。Returns a new array; the
 * caller holds the lyrics in React state and must not have them mutated
 * underneath it.
 *
 * Deliberately does **not** re-sort. Re-ordering the list while somebody is
 * tapping down it would move the next line out from under their finger, which
 * is the one thing this interaction cannot do. Sorting happens when it is
 * saved and parsed back.
 */
export function stampLine(lines: LyricLine[], index: number, seconds: number): LyricLine[] {
  if (index < 0 || index >= lines.length) return lines

  const next = [...lines]
  const line = next[index]
  if (!line) return lines

  next[index] = { ...line, timeMs: Math.max(0, Math.round(seconds * 1000)) }
  return next
}

/** Clears one line's timestamp, for a tap in the wrong place. */
export function clearStamp(lines: LyricLine[], index: number): LyricLine[] {
  if (index < 0 || index >= lines.length) return lines

  const next = [...lines]
  const line = next[index]
  if (!line) return lines

  next[index] = { ...line, timeMs: null }
  return next
}

/**
 * How far through the timing pass somebody is.
 *
 * Shown while tapping, because 「還有幾句」 is the only question anybody has
 * during it.
 */
export function stampProgress(lines: LyricLine[]): { stamped: number; total: number } {
  const total = lines.filter((line) => line.text.length > 0).length
  const stamped = lines.filter((line) => line.text.length > 0 && line.timeMs !== null).length
  return { stamped, total }
}
