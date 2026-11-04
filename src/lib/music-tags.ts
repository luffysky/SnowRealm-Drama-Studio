/**
 * 音樂的風格與情緒標籤庫 (Z119).
 *
 * 風格標籤 and 情緒氛圍 were free text with nothing but a placeholder for
 * guidance. That is how you end up with 古風, 古風音樂 and 中國風 as three
 * different tags meaning one thing — and once that has happened no filter can
 * put them back together.
 *
 * So there is a starter set to click, and typing still works for anything it
 * does not cover. The two together matter: a closed list would be wrong the
 * first time somebody needs a word nobody thought of, and a free field alone
 * is wrong by the third upload.
 *
 * The lists are seeds, not a schema. A tag that has been used in this project
 * is offered alongside them (`usedMusicTags`), so what the studio actually
 * says ends up on the buttons without anybody maintaining a list.
 */

/**
 * 風格 — what kind of music it is.
 *
 * Weighted toward what this studio is making: a 古裝 short drama needs
 * 古風/國風/民樂 far more than it needs genre taxonomy from a record shop.
 */
export const GENRE_TAGS = [
  '古風',
  '國風',
  '民樂',
  '管弦',
  '鋼琴',
  '琵琶',
  '笛簫',
  '古箏',
  '戲曲',
  '電子',
  '流行',
  '搖滾',
  '說唱',
  '爵士',
  '環境音',
  '純演奏',
] as const

/**
 * 情緒 — how it should make the scene feel.
 *
 * Deliberately includes the uncomfortable ones. A library with only 溫暖 and
 * 熱血 cannot describe the scene where somebody loses everything, and that is
 * the scene you most need to find music for.
 */
export const MOOD_TAGS = [
  '磅礡',
  '熱血',
  '溫暖',
  '溫柔',
  '歡快',
  '詼諧',
  '市井煙火',
  '輕鬆',
  '緊張',
  '懸疑',
  '壓迫',
  '肅殺',
  '悲涼',
  '淒美',
  '孤寂',
  '空靈',
  '釋然',
] as const

export type GenreTag = (typeof GENRE_TAGS)[number]
export type MoodTag = (typeof MOOD_TAGS)[number]

/** At most this many suggestions, so the row does not become a wall. */
export const MAX_SUGGESTIONS = 24

/**
 * Presets first, then anything this project has used that is not already a
 * preset.
 *
 * Used tags come second rather than being merged alphabetically: the curated
 * ones are the common answers, and a list that reshuffles as the library
 * grows is a list nobody learns the shape of.
 */
export function suggestTags(presets: readonly string[], used: string[]): string[] {
  const seen = new Set(presets)
  const extra = used.filter((tag) => tag.trim() && !seen.has(tag))

  return [...presets, ...new Set(extra)].slice(0, MAX_SUGGESTIONS)
}
