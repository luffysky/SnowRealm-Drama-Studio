/**
 * 分集大綱 — parsing what the model returns (`docs/OUTLINE.md`).
 *
 * No database imports: the parser runs on both sides, and the generator dialog
 * needs it to show what it is about to write before anything is written.
 *
 * The model is asked for a fixed shape (see `OUTLINE_GENERATE` in
 * `src/lib/ai/prompts.ts`):
 *
 *   ### EP001
 *   標題：三文錢的生意
 *   一句話：沈知味醒來發現自己欠了一屁股債。
 *   大綱：……
 *
 * It mostly complies, and the places it does not are predictable: full-width
 * colons, a missing leading zero, `##` instead of `###`, a stray 「第1集」.
 * Rather than demand obedience, this tolerates the variations and reports what
 * it could not read, because a generation that cost money should not be thrown
 * away over a punctuation mark.
 */

export type ParsedOutline = {
  number: number
  title: string
  logline: string
  synopsis: string
}

export type OutlineParseResult = {
  entries: ParsedOutline[]
  /** Chunks that looked like an episode but could not be read. */
  unparsed: string[]
}

/** `###`/`##`/`#` + EP001 / EP 1 / 第001集 / 第 1 集. */
const HEADING = /^#{1,4}\s*(?:EP\s*|第\s*)(\d{1,3})\s*(?:集)?\s*$/i

/** `標題：…` with either colon, optionally bolded by the model. */
function fieldOf(line: string, names: string[]): string | null {
  const cleaned = line.replace(/\*\*/g, '').trim()
  for (const name of names) {
    const match = new RegExp(`^${name}\\s*[:：]\\s*(.*)$`).exec(cleaned)
    if (match) return (match[1] ?? '').trim()
  }
  return null
}

export function parseOutline(text: string): OutlineParseResult {
  const lines = text.split(/\r?\n/)

  const entries: ParsedOutline[] = []
  const unparsed: string[] = []

  let current: { number: number; lines: string[] } | null = null

  const flush = () => {
    if (!current) return
    const parsed = readEntry(current.number, current.lines)
    if (parsed) entries.push(parsed)
    else unparsed.push(`EP${String(current.number).padStart(3, '0')}`)
    current = null
  }

  for (const line of lines) {
    const heading = HEADING.exec(line.trim())
    if (heading) {
      flush()
      current = { number: Number(heading[1]), lines: [] }
      continue
    }
    if (current) current.lines.push(line)
  }

  flush()

  return { entries, unparsed }
}

function readEntry(number: number, lines: string[]): ParsedOutline | null {
  let title = ''
  let logline = ''
  const synopsis: string[] = []

  /*
   * 大綱 runs to the end of the block, so once it starts every remaining line
   * belongs to it — including blank ones between paragraphs.
   */
  let inSynopsis = false

  for (const line of lines) {
    if (!inSynopsis) {
      const titleValue = fieldOf(line, ['標題', '題目', 'title'])
      if (titleValue !== null) {
        title = stripEpisodePrefix(titleValue)
        continue
      }

      const loglineValue = fieldOf(line, ['一句話', '一句話簡介', 'logline', '梗概'])
      if (loglineValue !== null) {
        logline = loglineValue
        continue
      }

      const synopsisValue = fieldOf(line, ['大綱', '劇情大綱', 'synopsis', '內容'])
      if (synopsisValue !== null) {
        inSynopsis = true
        if (synopsisValue) synopsis.push(synopsisValue)
        continue
      }

      // Prose before any field: treat it as the synopsis rather than lose it.
      if (line.trim() && !line.trim().startsWith('-')) synopsis.push(line.trim())
      continue
    }

    synopsis.push(line)
  }

  const body = synopsis.join('\n').trim()

  // An entry with nothing in it is not worth writing over an existing row.
  if (!title && !logline && !body) return null

  return {
    number,
    title,
    logline,
    synopsis: body,
  }
}

/**
 * Drops a 「第 12 集」 prefix the model sometimes puts in the title.
 *
 * The episode number is already a column; repeating it in the title makes
 * every list read 「EP012 第12集 …」.
 */
function stripEpisodePrefix(title: string): string {
  return title
    .replace(/^第\s*\d{1,3}\s*集\s*[：:、．.\-—]?\s*/, '')
    .replace(/^EP\s*\d{1,3}\s*[：:、．.\-—]?\s*/i, '')
    .trim()
}

/**
 * What an outline edit would change, so the UI can show it before writing.
 *
 * Only fields the model actually produced count: a blank title in the
 * generated entry means "it did not write one", never "clear the existing
 * one". Overwriting written work with silence is the one unrecoverable
 * mistake this feature could make.
 */
export type OutlineDiff = {
  number: number
  episodeId: string
  changes: { field: 'title' | 'logline' | 'synopsis'; before: string; after: string }[]
}

export function diffOutline(
  generated: ParsedOutline[],
  existing: { id: string; number: number; title: string; logline: string; synopsis: string }[]
): OutlineDiff[] {
  const byNumber = new Map(existing.map((row) => [row.number, row]))
  const out: OutlineDiff[] = []

  for (const entry of generated) {
    const row = byNumber.get(entry.number)
    if (!row) continue

    const changes: OutlineDiff['changes'] = []

    for (const field of ['title', 'logline', 'synopsis'] as const) {
      const after = entry[field].trim()
      const before = row[field].trim()
      if (after && after !== before) changes.push({ field, before, after })
    }

    if (changes.length > 0) out.push({ number: entry.number, episodeId: row.id, changes })
  }

  return out
}

export const OUTLINE_FIELD_LABEL: Record<'title' | 'logline' | 'synopsis', string> = {
  title: '標題',
  logline: '一句話',
  synopsis: '大綱',
}
