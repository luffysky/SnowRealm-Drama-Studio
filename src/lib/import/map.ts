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
   * 第二輪：包含，而且取**命中最長的那一個**。
   *
   * 「鏡頭景別（必填）」這種帶補充說明的欄名很常見，而要求人把標題改乾淨不
   * 是這個功能該做的事。只比較長的那一邊包含較短的那一邊，而且短的至少要兩
   * 個字——一個字的別名（例如「秒」）去包含比對會把「秒數」以外的東西也收進
   * 來。
   *
   * **取最長而不是宣告順序第一個** (Z190)：生圖提示詞的別名「提示詞」是「負
   * 面提示詞」的子字串，而它宣告在前面——照順序取的話，「負向提示詞」這一欄
   * 會被對到**正向**提示詞，而正向提示詞是直接餵給生圖的。不報錯，要到出圖
   * 才看得出來。
   *
   * 同一個根因還有「場景」被對到「場次代號」：`地點` 先認領 `location` 之
   * 後，`場景` 去撞 `sceneCode` 的別名。取最長之後，`場景` 與 `場景代號` 的
   * 命中長度比得出高下。
   */
  headers.forEach((_, index) => {
    if (mapping[index]) return
    const head = folded[index]!
    if (!head) return

    let best: { field: ImportField; length: number } | null = null
    for (const field of target.fields) {
      if (taken.has(field.key)) continue
      if (negativeMismatch(head, field.key)) continue
      for (const name of candidates(field)) {
        if (name.length < 2) continue
        /*
         * **只收「欄名包含別名」**，不收反過來的。
         *
         * 反過來（別名包含欄名）代表欄名比別名更短、更不明確，而那是一個很
         * 弱的訊號——`場景` 會因此撞上 `場次代號`，於是一段場景描述寫進一個
         * 長度上限 20 的代號欄。寧可留 null 讓人自己選。
         */
        if (!head.includes(name)) continue
        if (!best || name.length > best.length) best = { field, length: name.length }
      }
    }
    if (best) claim(index, best.field)
  })

  return mapping
}

/**
 * 正向與負向提示詞不准互串 (Z190).
 *
 * 「提示詞」是「負向提示詞」的子字串，所以任何帶「負」「反」的欄名都會落進
 * **正向**欄位——而正向提示詞是直接餵給生圖的。不報錯，要到出圖才看得出來。
 *
 * 所以：欄名看起來是負向的，就只准對到負向欄位；看起來不是負向的，就不准對
 * 到負向欄位。這不是通用規則，是針對一個會悄悄產生壞圖的具體情況。
 */
const NEGATIVE_WORDS = ['負', '负', '反向', '排除', 'negative', 'exclude']

function negativeMismatch(head: string, key: string): boolean {
  const headIsNegative = NEGATIVE_WORDS.some((word) => head.includes(foldHeader(word)))
  const fieldIsNegative = key.toLowerCase().includes('negative')
  return headIsNegative !== fieldIsNegative
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
  rows: Record<string, string | number | null | string[]>[]
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
  const rows: Record<string, string | number | null | string[]>[] = []
  const skipped: number[] = []
  const pending = new Map<string, NewVocabulary>()

  sheet.rows.forEach((line, index) => {
    const rowNumber = index + 1
    const record: Record<string, string | number | null | string[]> = {}
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

    /*
     * 整列空白的直接跳過，不報錯——尾端的空行很常見。
     *
     * 但「原始那一列有字、只是每一格都沒被收進 record」不算空白 (Z190)：列
     * 舉值認不得的時候不放值進 record，於是一列只填了「狀態: 審核中」的資料
     * 會被當成空行跳過——而畫面上的訊息寫著「會用預設值」。說的跟做的不一
     * 樣，比兩者都錯更難查。
     */
    const blankSource = mapping.every(
      (key, column) => !key || !(line[column] ?? '').trim()
    )
    const empty =
      blankSource &&
      Object.values(record).every(
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
  value?: string | number | null | string[]
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
      const cleaned = cleanNumber(raw)
      if (cleaned === null) {
        return { issues: [{ text: `「${raw}」看不出是數字`, level: 'error' }] }
      }
      const parsed = field.type === 'int' ? Math.round(cleaned) : cleaned
      if (field.min !== undefined && parsed < field.min) {
        /*
         * **負數不夾，直接擋下來** (Z190).
         *
         * 把 -500 夾成 0 是在虛構一個數字——而 0 看起來完全正常，沒有人會回
         * 頭查。超過上限夾住是另一回事（120 秒的鏡頭多半是單位寫錯，夾住之
         * 後還能用），但正負號是有意義的。
         */
        if (parsed < 0) {
          return {
            issues: [
              { text: `${parsed} 是負數，而${field.label}不能是負的`, level: 'error' },
            ],
          }
        }
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
      /*
       * 一格可以寫好幾個人 (Z194).
       *
       * 「沈知味、錢管事」是一鏡兩人對話，不是打錯字——`shot_speakers` 放得下
       * 好幾個，所以照頓號拆開一個一個對。順序就是寫的順序，而那正是說話的
       * 順序。
       *
       * 一個名字裡本來就有頓號的角色會被這條拆壞，但那種名字在角色表裡也會
       * 被當成兩個人讀，所以問題在名字不在這裡。
       */
      const parts = raw
        .split(/[、，,;；/／|｜]+/)
        .map((part) => part.trim())
        .filter(Boolean)

      const ids: string[] = []
      const missing: string[] = []
      for (const part of parts) {
        const id = context.characters.get(foldForSearch(part))
        if (id) {
          // 同一個人寫兩次只算一次，不然會撞到 `(shot_id, character_id)` 主鍵。
          if (!ids.includes(id)) ids.push(id)
        } else {
          missing.push(part)
        }
      }

      const issues: { text: string; level: 'warning' }[] = []
      if (missing.length > 0) {
        issues.push({
          text:
            missing.length === parts.length
              ? `找不到叫「${raw}」的角色，這一欄會留空`
              : `找不到「${missing.join('、')}」這${missing.length > 1 ? '幾' : ''}個角色，其餘的照常匯入`,
          level: 'warning',
        })
      }

      return ids.length > 0 ? { value: ids, issues } : { issues }
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
 * 一格文字變成數字，而**看不懂就說看不懂** (Z190).
 *
 * 原本的做法是「把逗號與空白拿掉、把非數字字元拿掉，然後 parseFloat」。那一
 * 條路會把這些悄悄變成別的數字：
 *
 *     1 200,50   → 120050     歐式寫法的小數點被當成千分位吃掉（差一百倍）
 *     (500)      → 500        會計的負數括號被丟掉
 *     3-5        → 3          一個範圍被截成下界
 *     1.2.3      → 1          版本號被當成數字
 *
 * 所以改成**先認出整個字串的形狀**再轉。認不出來就回 null，由呼叫端報成錯
 * 誤——一個看不懂的金額應該擋下來，不是猜一個。
 */
function cleanNumber(raw: string): number | null {
  const text = raw
    // 全形數字與全形標點先換成半形。
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，]/g, ',')
    .replace(/[．]/g, '.')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .trim()

  // 會計的負數：`(500)`。
  const accounting = /^\((.*)\)$/.exec(text)
  const body = accounting ? accounting[1]! : text
  const sign = accounting ? -1 : 1

  /*
   * 把幣別符號與單位拿掉，但**只在頭尾**——中間出現的東西（`3-5`、`1.2.3`）
   * 代表這不是一個數字，而不是「有雜訊的數字」。
   */
  const core = body
    .replace(/^[^\d+-]+/, '')
    .replace(/[^\d]+$/, '')
    .trim()

  // 千分位逗號：只有在「三位一組」時才算，否則它是小數點。
  const grouped = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(core)
  const normalised = grouped ? core.replace(/,/g, '') : core.replace(/,/g, '.')

  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(normalised)) return null

  const value = Number(normalised)
  return Number.isFinite(value) ? sign * value : null
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
