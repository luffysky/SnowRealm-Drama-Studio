import {
  CAMERA_MOVES,
  CAMERA_MOVE_LABEL,
  SHOT_SIZES,
  SHOT_SIZE_LABEL,
} from '@/lib/constants'

/**
 * 可以自己加選項的那幾個下拉 (Z184).
 *
 * 這個檔案**不碰 `@/db`**，所以用戶端元件 import 得了（見
 * `npm run check:client`）。查資料庫的那一半在 `@/lib/vocabulary`。
 *
 * ## 為什麼不是每一個下拉
 *
 * 這個 schema 有 39 個 pg enum，而其中一半是**程式在判斷的**：上傳狀態、任務
 * 狀態、AI 任務狀態、通話狀態、製作階段。多一個值出來，製作流程的完成判定、
 * 看板分欄、篩選器會各自用各自的方式忽略它——那不是「多一個選項」，是三個地
 * 方各壞一種壞法，而且壞得很安靜。
 *
 * 能接上來的條件只有一個：**沒有任何程式分支讀它的值**。景別與運鏡符合——它
 * 們從頭到尾只被拿去顯示與餵給生圖提示詞。
 *
 * 要再開一種的時候，三件事缺一不可：(1) 欄位從 enum 改成 text（見
 * `drizzle/0035`），(2) 加進這張表，(3) 確認沒有人用它的值做判斷。第三件是
 * 要用 grep 的，不是用印象的。
 */

export const VOCABULARY_KINDS = ['shot_size', 'camera_move'] as const
export type VocabularyKind = (typeof VOCABULARY_KINDS)[number]

export type VocabularyTerm = {
  id: string
  kind: VocabularyKind
  value: string
  label: string
}

/** 一個下拉的選項。 */
export type VocabularyOption = {
  value: string
  label: string
  /** 內建的不能刪。 */
  builtIn: boolean
  /** 自訂的才有，刪的時候要。 */
  id?: string
}

type Definition = {
  label: string
  values: readonly string[]
  labels: Record<string, string>
}

const DEFINITIONS: Record<VocabularyKind, Definition> = {
  shot_size: { label: '景別', values: SHOT_SIZES, labels: SHOT_SIZE_LABEL },
  camera_move: { label: '運鏡', values: CAMERA_MOVES, labels: CAMERA_MOVE_LABEL },
}

export function vocabularyLabel(kind: VocabularyKind): string {
  return DEFINITIONS[kind].label
}

export function isVocabularyKind(value: unknown): value is VocabularyKind {
  return typeof value === 'string' && (VOCABULARY_KINDS as readonly string[]).includes(value)
}

/**
 * 內建的那幾個，加上使用者自己加的，照這個順序。
 *
 * 內建的在前面是刻意的：那是電影語言的標準階梯（大遠景→大特寫），打亂它會讓
 * 一個照順序找的人找不到東西。自訂的接在後面，依 `sortOrder` 再依建立時間。
 */
export function vocabularyOptions(
  kind: VocabularyKind,
  terms: readonly VocabularyTerm[]
): VocabularyOption[] {
  const definition = DEFINITIONS[kind]
  const builtIn = definition.values.map((value) => ({
    value,
    label: definition.labels[value] ?? value,
    builtIn: true,
  }))

  const builtInLabels = new Set(builtIn.map((option) => option.label))
  const custom = terms
    .filter((term) => term.kind === kind)
    // 內建的值不能被自訂的蓋掉——否則改一個標籤就能讓 `MS` 變成別的意思。
    .filter((term) => !definition.values.includes(term.value))
    /*
     * 標籤也不能撞。新增的時候擋過一次，但**內建的標籤會改**——`MCU` 在
     * Z182 從「中近景」改成「近景」，而在那之前自己加一個叫「近景」的人，從
     * 那一刻起下拉裡就有兩個一模一樣的選項。擋在這裡的話，改標籤不會製造出
     * 那種畫面。
     */
    .filter((term) => !builtInLabels.has(term.label))
    .map((term) => ({ value: term.value, label: term.label, builtIn: false, id: term.id }))

  return [...builtIn, ...custom]
}

/**
 * 一個值該顯示成什麼字。
 *
 * **查不到就回那個值本身，不回空字串。** 這一欄現在是 text，所以資料庫裡可能
 * 有一個已經被刪掉的自訂值——那時候畫面上要看得到 `HANDHELD_LOW`，而不是一個
 * 空格。空格會讓人以為那一格沒填。
 */
export function vocabularyTermLabel(
  kind: VocabularyKind,
  value: string,
  terms: readonly VocabularyTerm[]
): string {
  const definition = DEFINITIONS[kind]
  if (definition.labels[value]) return definition.labels[value]
  return terms.find((term) => term.kind === kind && term.value === value)?.label ?? value
}

/**
 * 從使用者打的標籤推一個值出來。
 *
 * 「近景特寫」→ `CUSTOM_1`？不行——值要看得懂，因為它會出現在 AI 提示詞、匯
 * 出的 CSV、以及之後任何一個讀資料庫的人眼前。所以取標籤裡的 ASCII 字母數
 * 字；中文標籤沒有可取的，就回空字串讓呼叫端要求使用者自己填。
 */
export function suggestVocabularyValue(label: string): string {
  const ascii = label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return ascii.slice(0, 32)
}

/** 值的長相：大寫英數底線，跟內建的那幾個一致。 */
export const VOCABULARY_VALUE_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/

export function isVocabularyValue(value: string): boolean {
  return VOCABULARY_VALUE_PATTERN.test(value)
}
