import { firstJsonBlock, unwrapJson } from '@/lib/ai/json-text'

/**
 * 編劇助手：把模型回的東西讀成可以排版的形狀（Z198）。
 *
 * 純函式，沒有 `@/db`——用戶端要 import 這些型別來排版，而一旦它拉到資料層就
 * 會把整個 db 拖進 bundle（`check:client` 擋的就是這個）。
 *
 * ## 這一份要回答的是暖寶問的四件事
 *
 * > 審核劇情是否連貫合理，細節處理是否得當，總結一下目前的主線、人設，
 * > 每一集是否有爽點和鉤子，爽點在哪裡，鉤子是什麼。
 *
 * 所以形狀是照那四句話長的，不是照「一份審稿報告」的通用樣板長的。**「爽點在
 * 哪裡」要能指出位置**，所以每一項都帶原文——沒有原文的判斷在這裡沒有價值，
 * 她要的是「整理給我看」，不是一個分數。
 *
 * ## JSON 的鍵用英文
 *
 * 中文鍵合法，但模型在長輸出裡把鍵打成半形冒號、簡繁混用、或多一個空白的機率
 * 比英文鍵高得多，而那些都會讓 `JSON.parse` 之後的欄位變成 `undefined`——
 * 那是最難查的一種壞法：解析成功、資料是空的。顯示用的中文在畫面那一層。
 */

/** 一集的整理。 */
export type EpisodeAudit = {
  /** 本集主要事件，按發生順序。 */
  events: string[]
  payoff: AuditBeat
  hook: AuditBeat
  /** 細節處理不當之處。 */
  details: AuditNote[]
  /** 連貫性或合理性上的疑點。 */
  doubts: AuditDoubt[]
}

/** 爽點或鉤子。`present: false` 時 `what` 說的是「為什麼沒有」。 */
export type AuditBeat = {
  present: boolean
  what: string
  /** 爽點在哪裡——段落位置的描述，例如「後段，灶前對質」。 */
  where: string
  /** 原文引文。沒有引文的判斷不要相信。 */
  quote: string
}

export type AuditNote = { issue: string; quote: string }

export type AuditDoubt = {
  question: string
  quote: string
  /** 為什麼這件事讓人卡住。 */
  why: string
}

/**
 * 一輪問答。
 *
 * 放在 view 這一支而不是 `story-audit.ts`：畫面要保存這些、要顯示這些、匯出也
 * 要帶上這些，而 `story-audit.ts` 會 import `@/db`——用戶端為了一個型別把整個
 * 資料層拉進 bundle，正是 `check:client` 擋的事。
 */
export type AskTurn = { question: string; answer: string }

/** 全書整理：主線與人設現況。 */
export type StoryDigest = {
  /** 到目前為止的主線，三到六句。 */
  mainline: string
  /** 支線。 */
  threads: string[]
  characters: DigestCharacter[]
  /** 跨集的問題。 */
  issues: AuditDoubt[]
}

export type DigestCharacter = {
  name: string
  /** 這個人現在是什麼樣子。 */
  now: string
  /** 他想要什麼。 */
  wants: string
  /** 從第一集到現在變了什麼；沒變就說沒變。 */
  changed: string
}

/* -------------------------------------------------------------------------- */

/**
 * 暖寶的四個問題，寫成給模型看的句子。
 *
 * 放在這裡而不是 prompts.ts 裡，是因為說明頁要把同一份清單顯示給人看——讓人
 * 知道這份報告在回答什麼問題。兩邊各抄一份的話，改了提示詞而說明頁還在講舊
 * 的那一版，而那種不一致沒有任何工具抓得到。
 */
export const AUDIT_QUESTIONS = [
  '劇情是否連貫合理',
  '細節處理是否得當',
  '目前的主線與人設',
  '每一集有沒有爽點和鉤子，爽點在哪裡，鉤子是什麼',
] as const

/* -------------------------------------------------------------------------- */

/**
 * 存起來的那一份（Z200）。
 *
 * `kind` 是 text 不是 enum（Z184 的教訓：pg 的 enum 加了就刪不掉），所以合法值
 * 由這裡把關——資料庫擋不住，應用程式要擋。
 */
export const REPORT_KINDS = ['DIGEST', 'EPISODE', 'ASK'] as const
export type WriterReportKind = (typeof REPORT_KINDS)[number]

export function isReportKind(value: string): value is WriterReportKind {
  return (REPORT_KINDS as readonly string[]).includes(value)
}

export const REPORT_KIND_LABEL: Record<WriterReportKind, string> = {
  DIGEST: '主線與人設',
  EPISODE: '逐集整理',
  ASK: '問答',
}

export type SavedReport = {
  id: string
  episodeId: string | null
  episodeNumber: number | null
  kind: WriterReportKind
  title: string
  /** 形狀依 `kind` 而定。畫之前要先用下面那幾支轉回來。 */
  payload: unknown
  model: string
  createdByName: string
  /** ISO 字串——伺服器端元件把 `Date` 傳給用戶端元件會被 Next 擋下來。 */
  createdAt: string
}

/** 存起來的那一份是不是一集的整理。轉型之前先問。 */
export function asEpisodeAudit(report: SavedReport): EpisodeAudit | null {
  return report.kind === 'EPISODE' ? (report.payload as EpisodeAudit) : null
}

export function asStoryDigest(report: SavedReport): StoryDigest | null {
  return report.kind === 'DIGEST' ? (report.payload as StoryDigest) : null
}

export function asTurns(report: SavedReport): AskTurn[] {
  return report.kind === 'ASK' && Array.isArray(report.payload)
    ? (report.payload as AskTurn[])
    : []
}

/* -------------------------------------------------------------------------- */

export type Parsed<T> = { value: T | null; problem: string | null }

/** 一集的整理。讀不出來就說讀不出來，不要回一個半空的物件。 */
export function parseEpisodeAudit(text: string): Parsed<EpisodeAudit> {
  const raw = readJson(text)
  if (!raw.value) return { value: null, problem: raw.problem }

  const source = raw.value as Record<string, unknown>
  const value: EpisodeAudit = {
    events: stringList(source.events),
    payoff: beat(source.payoff),
    hook: beat(source.hook),
    details: noteList(source.details),
    doubts: doubtList(source.doubts),
  }

  /*
   * 整份都是空的就當作沒讀到。
   *
   * 模型回了一個結構正確但每一欄都是空字串的物件時，上面每一支都會乖乖回預設
   * 值，於是畫面會顯示一份「這一集沒有爽點、沒有鉤子、沒有問題」的報告——而那
   * 跟「我讀不出來」是完全不同的兩件事，偏偏長得一模一樣。
   */
  const empty =
    value.events.length === 0 &&
    !value.payoff.what &&
    !value.hook.what &&
    value.details.length === 0 &&
    value.doubts.length === 0
  if (empty) return { value: null, problem: '模型回的內容每一欄都是空的' }

  return { value, problem: null }
}

export function parseStoryDigest(text: string): Parsed<StoryDigest> {
  const raw = readJson(text)
  if (!raw.value) return { value: null, problem: raw.problem }

  const source = raw.value as Record<string, unknown>
  const value: StoryDigest = {
    mainline: str(source.mainline),
    threads: stringList(source.threads),
    characters: characterList(source.characters),
    issues: doubtList(source.issues),
  }

  if (!value.mainline && value.characters.length === 0) {
    return { value: null, problem: '模型沒有給出主線，也沒有給出人物' }
  }
  return { value, problem: null }
}

/* -------------------------------------------------------------------------- */

function readJson(text: string): Parsed<unknown> {
  const unwrapped = unwrapJson(text)
  try {
    return { value: JSON.parse(unwrapped) as unknown, problem: null }
  } catch {
    // 前後多寫了一句話的情況。
    const sliced = firstJsonBlock(unwrapped)
    if (!sliced) return { value: null, problem: '回覆裡找不到 JSON' }
    try {
      return { value: JSON.parse(sliced) as unknown, problem: null }
    } catch {
      return { value: null, problem: '回覆裡那段 JSON 讀不開' }
    }
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(str).filter(Boolean)
}

function beat(value: unknown): AuditBeat {
  if (!value || typeof value !== 'object') {
    return { present: false, what: '', where: '', quote: '' }
  }
  const source = value as Record<string, unknown>
  const what = str(source.what)
  return {
    /*
     * `present` 以**有沒有講出是什麼**為準，不是以模型給的布林為準。
     *
     * 模型很常回 `{ present: true, what: "" }`——它想說「有吧」，但說不出是什
     * 麼。那種情況在畫面上要算「沒有」，不然會出現一個寫著「有爽點」而底下一
     * 片空白的格子。
     */
    present: typeof source.present === 'boolean' ? source.present && Boolean(what) : Boolean(what),
    what,
    where: str(source.where),
    quote: str(source.quote),
  }
}

function noteList(value: unknown): AuditNote[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const source = item as Record<string, unknown>
      const issue = str(source.issue)
      return issue ? { issue, quote: str(source.quote) } : null
    })
    .filter((item): item is AuditNote => item !== null)
}

function doubtList(value: unknown): AuditDoubt[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const source = item as Record<string, unknown>
      const question = str(source.question)
      return question ? { question, quote: str(source.quote), why: str(source.why) } : null
    })
    .filter((item): item is AuditDoubt => item !== null)
}

function characterList(value: unknown): DigestCharacter[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const source = item as Record<string, unknown>
      const name = str(source.name)
      if (!name) return null
      return {
        name,
        now: str(source.now),
        wants: str(source.wants),
        changed: str(source.changed),
      }
    })
    .filter((item): item is DigestCharacter => item !== null)
}
