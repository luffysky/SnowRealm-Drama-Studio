/**
 * Search types and labels, with no database imports.
 *
 * The palette is a Client Component, and importing these from
 * `@/lib/search` would drag Drizzle and `pg` into the browser bundle — the
 * same mistake that broke the build for `@/lib/episodes` (see
 * `src/lib/episode-view.ts`).
 */

export type SearchKind =
  | 'PROJECT'
  | 'EPISODE'
  | 'CHAPTER'
  | 'SCENE'
  | 'WORLD_ENTRY'
  | 'WORLD_EVENT'
  | 'CHARACTER'

export const SEARCH_KINDS: readonly SearchKind[] = [
  'EPISODE',
  'CHAPTER',
  'SCENE',
  'CHARACTER',
  'WORLD_ENTRY',
  'WORLD_EVENT',
  'PROJECT',
]

export const SEARCH_KIND_LABEL: Record<SearchKind, string> = {
  PROJECT: '作品',
  EPISODE: '集數',
  CHAPTER: '小說',
  SCENE: '劇本',
  WORLD_ENTRY: '世界觀',
  WORLD_EVENT: '時間線',
  CHARACTER: '角色',
}

export type SearchHit = {
  id: string
  /** Which project the hit is in — the global palette can span several. */
  projectId: string
  projectTitle: string
  kind: SearchKind
  refId: string
  title: string
  snippet: string
  /** 0–1. Semantic and lexical scores are merged before this is reported. */
  score: number
  /** Which half found it, for the UI to be honest about the mode. */
  matchedBy: 'semantic' | 'lexical' | 'both'
  href: string
}

export type SearchResult = {
  hits: SearchHit[]
  /** False when the semantic half did not run: results are keyword-only. */
  semantic: boolean
  /**
   * Why it did not run, when it was supposed to.
   *
   * Null covers both "it worked" and "no key is configured" — the first needs
   * no explanation and the second already has one. This is for the third case:
   * a key exists but the call failed (throttled, rejected, provider down).
   * Without it the UI reports "no key configured", which sends the reader off
   * to check an environment variable that is perfectly fine.
   */
  semanticError: string | null
  total: number
}

export type IndexStatus = {
  rows: number
  embedded: number
  lastIndexedAt: string | null
  semantic: boolean
  /** Set when content changed after the last index. Null means current. */
  dirtySince: string | null
}

export const MATCHED_BY_LABEL: Record<SearchHit['matchedBy'], string> = {
  semantic: '語意',
  lexical: '關鍵字',
  both: '語意＋關鍵字',
}
