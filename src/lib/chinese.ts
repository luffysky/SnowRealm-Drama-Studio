import * as OpenCC from 'opencc-js'

/**
 * 繁簡轉換 (Z135).
 *
 * 作品是用繁體寫的，但有大陸市場，而且暖寶本人就是大陸人——所以讀的時候要
 * 看得到簡體，**而且預設就是簡體**。
 *
 * 兩條規矩：
 *
 * 1. **只在顯示的時候轉，永遠不動存起來的正文。** 轉換是有損的：簡體轉回
 *    繁體是一對多，`乾`/`幹`/`干` 都是 `干`。把轉換後的結果存回去，等於把
 *    作者寫的字換掉，而且換不回來。
 *
 * 2. **用詞彙層級的轉換，不要用單字對照表。** 這不是講究，是對錯問題：
 *
 *        頭髮 → 头发      發現 → 发现      （同一個「發」，兩個簡體字）
 *        著火 → 着火      顯著 → 显著      （同一個「著」）
 *        乾淨 → 干净      乾坤 → 乾坤      （「乾」有時候根本不轉）
 *        沈知味 → 沈知味                   （姓氏不會變成「沉」）
 *
 *    單字對照表這四組全部會錯，而且錯得很安靜——讀起來像錯字，不像壞掉。
 *    OpenCC 的字典答得對，所以用它而不是自己寫一張表。
 */

export type ScriptPreference = 'original' | 'simplified' | 'traditional'

export const SCRIPT_LABEL: Record<ScriptPreference, string> = {
  original: '原文',
  simplified: '简体',
  traditional: '繁體',
}

/**
 * 預設簡體.
 *
 * 作者寫的是繁體，所以 `original` 就是繁體——但讀者預設看到的是簡體。這是
 * 刻意的：這個工作室的小說是給大陸市場看的，而「原文」這個選項留給想看作者
 * 原字的人。
 */
export const DEFAULT_SCRIPT: ScriptPreference = 'simplified'

/*
 * Built once, on first use.
 *
 * The dictionaries are the bulk of this library, and most pages never convert
 * anything. Creating the converter eagerly would make every import pay for
 * them — so this stays lazy, and the reader dynamic-imports the whole module.
 */
let toCn: ((text: string) => string) | null = null
let toTw: ((text: string) => string) | null = null

function simplifier(): (text: string) => string {
  /*
   * `tw` rather than `t`: the source is Taiwanese Traditional, and the
   * Taiwan-specific readings are what this novel is written in.
   */
  toCn ??= OpenCC.Converter({ from: 'tw', to: 'cn' })
  return toCn
}

function traditionaliser(): (text: string) => string {
  toTw ??= OpenCC.Converter({ from: 'cn', to: 'tw' })
  return toTw
}

/** 繁 → 簡. */
export function toSimplified(text: string): string {
  if (!text) return text
  return simplifier()(text)
}

/**
 * 簡 → 繁.
 *
 * Offered for completeness, but it is the lossy direction: one simplified
 * character can stand for several traditional ones and only context decides.
 * OpenCC's phrase dictionary handles the common cases; the rest will
 * occasionally be wrong, which is why the stored prose is never run through
 * it.
 */
export function toTraditional(text: string): string {
  if (!text) return text
  return traditionaliser()(text)
}

/** Whichever the reader asked for. `original` is returned untouched. */
export function convertScript(text: string, preference: ScriptPreference): string {
  if (preference === 'simplified') return toSimplified(text)
  if (preference === 'traditional') return toTraditional(text)
  return text
}

/**
 * Converts a whole chapter's paragraphs in one pass.
 *
 * One converter call per paragraph rather than joining and splitting: a
 * separator would have to be a character that cannot appear in the prose, and
 * there is no such character.
 */
export function convertParagraphs(
  paragraphs: readonly string[],
  preference: ScriptPreference
): string[] {
  if (preference === 'original') return [...paragraphs]
  const convert = preference === 'simplified' ? simplifier() : traditionaliser()
  return paragraphs.map((text) => (text ? convert(text) : text))
}

export function isScriptPreference(value: unknown): value is ScriptPreference {
  return value === 'original' || value === 'simplified' || value === 'traditional'
}
