/**
 * 一集的小說寫完了沒有 (Z118).
 *
 * Not a word count. 4,000 characters was only ever a rough target for a
 * 120–180 second episode, and a chapter sitting at 110% of it can still be
 * half a scene short — while one at 60% can be finished because it turned out
 * tighter than planned. A percentage answers 「寫了多少」; it cannot answer
 * 「寫完了嗎」.
 *
 * The author already answers that, in the text:
 *
 *     ……終於讓兩個本不該在此相遇的人，再次站在了彼此面前。
 *
 *     第005集 完
 *
 * So that is what this looks for. It is an explicit act by the person who
 * knows, which is the only source that can be right.
 */

/**
 * The end marker, as a Postgres-compatible regular expression.
 *
 * One definition, used by both the TypeScript below and the SQL in
 * `stage-sync.ts`, because two copies of a rule like this drift and the drift
 * is silent — one of them would quietly stop marking episodes complete.
 *
 * Anchored to the end so a 「第001集 完」 quoted in the middle of a later
 * chapter is not mistaken for the end of this one. Spaces are optional
 * because 「第001集完」 and 「第 1 集 完」 are the same statement.
 */
export const END_MARKER_SOURCE =
  '(第[[:space:]]*[0-9]+[[:space:]]*集|本集|全(文|劇))[[:space:]]*(完|結|完結)[[:space:]]*$'

/** The same rule in JavaScript's dialect. */
const END_MARKER = /(第\s*(\d+)\s*集|本集|全[文劇])\s*(完|結|完結)\s*$/

/**
 * How much text at the end to examine.
 *
 * The marker is the last thing on the page. Searching the whole chapter would
 * match a 「第001集 完」 someone pasted into a note halfway down.
 */
const TAIL_CHARS = 40

export type EndMarker = {
  /** The episode number written in the marker, when it has one. */
  number: number | null
  /** The exact text that matched, for showing what was found. */
  text: string
}

/** Reads the end marker off a chapter's plain text, or null when there is none. */
export function endMarkerOf(text: string): EndMarker | null {
  const tail = text.trimEnd().slice(-TAIL_CHARS)
  const match = END_MARKER.exec(tail)
  if (!match) return null

  const digits = match[2]
  return {
    number: digits ? Number(digits) : null,
    text: match[0].trim(),
  }
}

/** Whether this episode's prose says it is finished. */
export function hasEndMarker(text: string): boolean {
  return endMarkerOf(text) !== null
}

/**
 * Whether the marker names a different episode than the one it sits in.
 *
 * Worth knowing: 「第004集 完」 at the end of episode 5 is a copy-paste that
 * nobody would notice by reading, and it means one of the two episodes is
 * not what its author thinks it is.
 */
export function markerMismatch(text: string, episodeNumber: number): number | null {
  const marker = endMarkerOf(text)
  if (!marker || marker.number === null) return null
  return marker.number === episodeNumber ? null : marker.number
}
