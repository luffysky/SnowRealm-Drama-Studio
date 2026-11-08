import { foldForSearch } from '@/lib/chinese'
import type { ImportField, ImportTarget } from '@/lib/import/targets'
import type { ImportSheet } from '@/lib/import/parse'
import { vocabularyOptions, type VocabularyTerm } from '@/lib/vocabulary-view'

/**
 * 把表格的欄對到欄位，再把每一格變成要存的值 (Z185).
 *
 * 純函式。**瀏覽器的預覽與伺服器的匯入跑的是同一支**——兩邊各寫一份的話，預
 * 覽會說「沒問題」而匯入會失敗，而那種不一致查起來最久。
 *
 * ## 自動對應只是起點，不是結論
 *
 * `detectMapping` 盡力猜，但介面一定要把猜的結果攤開讓人改。一個猜錯的對應
 * 會把台詞存進「誰說的」——它不報錯，而且要到配音的時候才會有人發現。
 */

/** 比對用：折繁簡、去空白與標點、轉小寫。 */
export function foldHeader(text: string): string {
  return foldForSearch(text)
    .toLowerCase()
    .replace(/[\s_\-/（）()［］[\]{}·、，,。.:：;；'"`]+/g, '')
}

/**
 * 每一欄對到哪個欄位，`null` 代表不匯入。
 *
 * 先找完全相等的，再找包含關係——完全相等優先是因為「秒數」與「預估秒數」兩
 * 個都存在時，前者不該被後者吃掉。
 */
export function detectMapping(
  headers: readonly string[],
  target: ImportTarget
): (string | null)[] {
  const taken = new Set<string>()
  const folded = headers.map(foldHeader)
  const mapping: (string | null)[] = headers.map(() => null)

  const claim = (index: number, field: ImportField) => {
    mapping[index] = field.key
    taken.add(field.key)
  }

  const candidates = (field: ImportField) =>
    [field.key, field.label, ...field.aliases].map(foldHeader).filter(Boolean)

  // 第一輪：完全相等。
  headers.forEach((_, index) => {
    if (mapping[index]) return
    const head = folded[index]!
    if (!head) return
    for (const field of target.fields) {
      if (taken.has(field.key)) continue
      if (candidates(field).includes(head)) {
        claim(index, field)
        return
      }
    }
  })

  /*
   * 第二輪：包含。
   *
   * 「鏡頭景別（必填）」這種帶補充說明的欄名很常見，而要求人把標題改乾淨不
   * 是這個功能該做的事。只比**較長的那一邊包含較短的那一邊**，而且短的至少
   * 要兩個字——一個字的別名（例如「秒」）去包含比對會把「秒數」以外的東西也
   * 收進來。
   */
  headers.forEach((_, index) => {
    if (mapping[index]) return
    const head = folded[index]!
    if (!head) return
    for (const field of target.fields) {
      if (taken.has(field.key)) continue
      const hit = candidates(field).some(
        (name) => name.length >= 2 && (head.includes(name) || name.includes(head))
      )
      if (hit) {
        claim(index, field)
        return
      }
    }
  })

  return mapping
}

/* -------------------------------------------------------------------------- */

export type CellIssue = {
  /** 第幾列（從 1 開始，不含標題列）。 */
  row: number
  field: string
  message: string
  /** `warning` 照樣匯入（用了預設或截斷），`error` 整列不匯入。 */
  level: 'warning' | 'error'
}

/** 匯入時要順手新增的下拉選項。 */
export type NewVocabulary = {
  kind: 'shot_size' | 'camera_move'
  value: string
  label: string
}

export type MappedRows = {
  /** 可以匯入的列。鍵是欄位 key。 */
  rows: Record<string, string | number | null>[]
  issues: CellIssue[]
  /** 要先建起來的下拉選項，已經去重。 */
  newVocabulary: NewVocabulary[]
  /** 整列被跳過的列號。 */
  skipped: number[]
}

export type MapContext = {
  /** 現有的自訂下拉選項。 */
  terms: readonly VocabularyTerm[]
  /** 角色名字 → id，用來對 `reference`。鍵已經折過繁簡。 */
  characters: ReadonlyMap<string, string>
}

export function mapRows(
  sheet: ImportSheet,
  mapping: readonly (string | null)[],
  target: ImportTarget,
  context: MapContext
): MappedRows {
  const byKey = new Map(target.fields.map((field) => [field.key, field]))
  const issues: CellIssue[] = []
  const rows: Record<string, string | number | null>[] = []
  const skipped: number[] = []
  const pending = new Map<string, NewVocabulary>()

  sheet.rows.forEach((line, index) => {
    const rowNumber = index + 1
    const record: Record<string, string | number | null> = {}
    let fatal = false

    mapping.forEach((key, column) => {
      if (!key) return
      const field = byKey.get(key)
      if (!field) return

      const raw = (line[column] ?? '').trim()
      const result = coerce(raw, field, context, pending)

      for (const message of result.issues) {
        issues.push({ row: rowNumber, field: field.label, message: message.text, level: message.level })
        if (message.level === 'error') fatal = true
      }
      if (result.value !== undefined) record[key] = result.value
    })

    // 必填欄位。整列空白的直接跳過，不報錯——尾端的空行很常見。
    const empty = Object.values(record).every(
      (value) => value === null || value === '' || value === undefined
    )
    if (empty) {
      skipped.push(rowNumber)
      return
    }

    for (const field of target.fields) {
      if (!field.required) continue
      const value = record[field.key]
      if (value === undefined || value === null || value === '') {
        issues.push({
          row: rowNumber,
          field: field.label,
          message: `${field.label}是必填的`,
          level: 'error',
        })
        fatal = true
      }
    }

    if (fatal) {
      skipped.push(rowNumber)
      return
    }
    rows.push(record)
  })

  return { rows, issues, newVocabulary: [...pending.values()], skipped }
}

/* -------------------------------------------------------------------------- */

type Coerced = {
  value?: string | number | null
  issues: { text: string; level: 'warning' | 'error' }[]
}

function coerce(
  raw: string,
  field: ImportField,
  context: MapContext,
  pending: Map<string, NewVocabulary>
): Coerced {
  if (!raw) return { issues: [] }

  switch (field.type) {
    case 'int':
    case 'decimal': {
      /*
       * 數字要先把人會打的東西拿掉：全形數字、千分位逗號、單位（「5 秒」）、
       * 幣別符號。模型與試算表兩邊都會產出這些，而 `Number('5 秒')` 是 NaN。
       */
      const cleaned = raw
        .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
        .replace(/[,，\s]/g, '')
        .replace(/[^\d.+-]/g, '')
      const parsed = field.type === 'int' ? Number.parseInt(cleaned, 10) : Number.parseFloat(cleaned)

      if (!Number.isFinite(parsed)) {
        return { issues: [{ text: `「${raw}」不是數字`, level: 'error' }] }
      }
      if (field.min !== undefined && parsed < field.min) {
        return {
          value: field.min,
          issues: [{ text: `${parsed} 小於下限 ${field.min}，改用 ${field.min}`, level: 'warning' }],
        }
      }
      if (field.max !== undefined && parsed > field.max) {
        return {
          value: field.max,
          issues: [{ text: `${parsed} 超過上限 ${field.max}，改用 ${field.max}`, level: 'warning' }],
        }
      }
      return { value: parsed, issues: [] }
    }

    case 'date': {
      const parsed = parseDate(raw)
      if (!parsed) return { issues: [{ text: `「${raw}」看不出是日期`, level: 'warning' }] }
      return { value: parsed, issues: [] }
    }

    case 'bool':
      return { value: /^(1|true|yes|y|是|對|有|✓)$/i.test(raw) ? 'true' : 'false', issues: [] }

    case 'tags':
      // 頓號、逗號、分號、斜線都算分隔。
      return { value: raw.split(/[、,，;；/|]+/).map((t) => t.trim()).filter(Boolean).join('\n'), issues: [] }

    case 'vocabulary': {
      const kind = field.vocabulary!
      const options = vocabularyOptions(kind, context.terms)
      const folded = foldHeader(raw)

      const hit = options.find(
        (option) =>
          foldHeader(option.value) === folded || foldHeader(option.label) === folded
      )
      if (hit) return { value: hit.value, issues: [] }

      /*
       * 認不得就**新增一個選項**，這是這個功能的重點之一。
       *
       * 代碼從標籤猜；純中文猜不出來（`suggestVocabularyValue` 會回空字
       * 串），那就用折疊後的拼寫不出來——所以退而求其次用一個固定前綴加序
       * 號，而**標籤照原樣留著**，人看得懂。
       */
      const key = `${kind}:${folded}`
      const existing = pending.get(key)
      if (existing) return { value: existing.value, issues: [] }

      const value = codeFor(raw, kind, options.map((o) => o.value), pending)
      pending.set(key, { kind, value, label: raw.slice(0, 20) })
      return {
        value,
        issues: [{ text: `「${raw}」不在清單裡，會新增成選項（代碼 ${value}）`, level: 'warning' }],
      }
    }

    case 'enum': {
      const values = field.enumValues ?? []
      const labels = field.enumLabels ?? {}
      const folded = foldHeader(raw)
      const hit = values.find(
        (value) => foldHeader(value) === folded || foldHeader(labels[value] ?? '') === folded
      )
      if (hit) return { value: hit, issues: [] }

      /*
       * 認不得**不自動新增**——這幾個是程式在判斷的（狀態、優先序、分類），
       * 多一個值出來，完成判定與看板分欄會各自用各自的方式忽略它。退回預設
       * 並且講出來。
       */
      return {
        issues: [
          {
            text: `「${raw}」不是${field.label}的選項（${values.map((v) => labels[v] ?? v).join('／')}），會用預設值`,
            level: 'warning',
          },
        ],
      }
    }

    case 'reference': {
      const id = context.characters.get(foldForSearch(raw))
      if (id) return { value: id, issues: [] }
      return {
        issues: [{ text: `找不到叫「${raw}」的角色，這一欄會留空`, level: 'warning' }],
      }
    }

    default: {
      const max = field.max ?? 100000
      if (raw.length > max) {
        return {
          value: raw.slice(0, max),
          issues: [{ text: `太長了（${raw.length} 字），截到 ${max} 字`, level: 'warning' }],
        }
      }
      return { value: raw, issues: [] }
    }
  }
}

/**
 * 自訂選項的代碼。
 *
 * 英文標籤直接拼；中文拼不出來就用類別前綴加序號。代碼看得見（它會出現在
 * AI 提示詞與匯出的檔案裡），所以寧可是 `SHOT_1` 這種看得懂是什麼類別的，也
 * 不要一串亂碼。
 */
function codeFor(
  label: string,
  kind: 'shot_size' | 'camera_move',
  used: readonly string[],
  pending: Map<string, NewVocabulary>
): string {
  const ascii = label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24)

  const taken = new Set([...used, ...[...pending.values()].map((item) => item.value)])
  const base = /^[A-Z]/.test(ascii) ? ascii : kind === 'shot_size' ? 'SHOT' : 'MOVE'

  if (!taken.has(base)) return base
  for (let i = 2; i < 999; i += 1) {
    const candidate = `${base}_${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}_${Date.now() % 100000}`
}

/**
 * 日期。
 *
 * 只收**看得出年月日**的寫法，不猜 `03/04/2026` 是三月四日還是四月三日——猜
 * 錯的日期跟對的日期長得一模一樣，而這種錯會一路活到結算。
 */
function parseDate(raw: string): string | null {
  const text = raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[年月]/g, '-')
    .replace(/日/g, '')
    .replace(/\//g, '-')
    .replace(/\./g, '-')
    .trim()

  const match = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(text)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3] ?? '1')
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const date = new Date(Date.UTC(year, month - 1, day))
  // 2 月 31 日會被 Date 推到三月——那不是使用者的意思，拒絕比猜好。
  if (date.getUTCMonth() !== month - 1) return null
  return date.toISOString()
}
