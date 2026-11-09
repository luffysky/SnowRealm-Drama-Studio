import { countRichTextChars } from '@/lib/utils'
import { unwrapJson } from '@/lib/ai/json-text'

/**
 * 把 AI 改編的輸出讀成場次 (Z30).
 *
 * `NOVEL_TO_SCRIPT` 的 prompt、定價、批次入口、選單按鈕全都在，而它產出的東
 * 西**沒有任何地方能套用**：`applyCandidate` 沒有這個分支，而 `ScriptEditor`
 * 也沒有給 `targetType`，所以「採用這份」只會把任務標成已採用，然後面板照實
 * 說「請自行複製需要的段落」。一整集的改編要人自己剪成十幾場貼進去。
 *
 * 這是 Z70 角色設計、Z71 分鏡、Z153 任務建議的同一個病，第四次：
 * **產出的形狀跟它要去的地方對不起來。**
 *
 * ## 為什麼放在這裡而不是 `script-apply.ts`
 *
 * 這一支是純函式，`script-apply.ts` 會 import `@/db`。混在一起的話，編輯器
 * 為了拿 `parseSceneList` 做預覽就得把整個資料層拉進用戶端 bundle——那正是
 * Z162 做 `check:client` 要擋的事，而 `tsc` 跟 `npm run check` 都抓不到，
 * 只有 `next build` 會。
 */

/** 一場戲。`code` 不在裡面——它由位置決定，見 `sceneCodeFor`。 */
export type SceneDraft = {
  heading: string
  location: string
  timeOfDay: string
  /** HTML，因為場次內容進的是 `RichTextEditor`。 */
  content: string
}

export type ParsedScenes = {
  scenes: SceneDraft[]
  /** 讀不出來的，連同原因。 */
  rejected: string[]
}

/**
 * 場次代號由位置決定，不由模型決定。
 *
 * `createScene` 本來就是這樣算的（「renumbering after a reorder is one update
 * instead of a manual pass」）。讓模型也寫一個，就是讓同一件事有兩個說法——
 * 模型跳號、重複、或從 S00 開始，都會讓重新排序之後的編號對不起來。
 */
export function sceneCodeFor(sortOrder: number): string {
  return `S${String(sortOrder).padStart(2, '0')}`
}



/**
 * 最後一招：從第一個括號切到最後一個。
 *
 * 模型在 JSON 前後多寫一句「以上是改編稿」時，`unwrap` 的錨定式 regex 不會
 * 命中（它要求整段就是那個 code fence），於是 `JSON.parse` 直接丟。這跟
 * `attribution.ts` 的做法一樣——那邊早就踩過。
 *
 * 我本來同時把 `unwrap` 的 regex 也放寬成非錨定的，破壞驗證才發現**那一步
 * 是多餘的**：把它改回錨定版，測試一條都沒變紅，因為這一支已經涵蓋了同樣
 * 的案例。兩個機制做同一件事，日後只會讓人分不清哪一個在生效。
 */
function sliceJson(text: string): string | null {
  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const start = text.indexOf(open)
    const end = text.lastIndexOf(close)
    if (start !== -1 && end > start) return text.slice(start, end + 1)
  }
  return null
}

/**
 * 從模型回的東西裡把場次陣列挖出來。
 *
 * 本來是「裸陣列，或物件裡**唯一**的陣列屬性」，照抄 `storyboard-apply.ts`。
 * 但 `json_object` 模式強迫最上層是物件，所以模型常回
 * `{"scenes":[...],"notes":[]}` 或 `{"result":{"scenes":[...]}}`——兩個陣列
 * 就退回、包兩層也退回，而那是一整集改編的錢。
 *
 * `attribution.ts` 早就為了同一個問題放寬過，這裡跟它走同一條路：
 * 先認 `scenes` 這個鍵，再退而求其次挑「最長的那個物件陣列」。
 * 挑最長的是因為雜訊陣列（`notes`、`warnings`）幾乎總是空的或比較短，
 * 而且裡面不是物件——猜錯的代價是解析出一堆被 `rejected` 擋下來的東西，
 * 不是寫進去。
 */
function arrayIn(value: unknown, depth = 0): unknown[] | null {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object' || depth > 2) return null

  const record = value as Record<string, unknown>

  if (Array.isArray(record.scenes)) return record.scenes

  const objectArrays = Object.values(record).filter(
    (entry): entry is unknown[] =>
      Array.isArray(entry) &&
      entry.length > 0 &&
      entry.every((row) => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
  )
  if (objectArrays.length > 0) {
    return objectArrays.reduce((best, entry) => (entry.length > best.length ? entry : best))
  }

  // `{"result":{"scenes":[...]}}` —— 再往下一層找。
  for (const entry of Object.values(record)) {
    const nested = arrayIn(entry, depth + 1)
    if (nested) return nested
  }

  return null
}

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/**
 * 讀不出來就說讀不出來，不要建一堆空白場次。
 *
 * 空白場次在畫面上看起來就像「生成好了，只是內容是空的」，而那比報錯難追十
 * 倍——Z70 就是這樣被抓到的。一場沒有內容的戲也會進片長估算的分母，讓「這一
 * 集 142 秒」變成算錯的結果。
 */
export function parseSceneList(text: string): ParsedScenes {
  const unwrapped = unwrapJson(text)

  let parsed: unknown
  try {
    parsed = JSON.parse(unwrapped)
  } catch {
    const sliced = sliceJson(unwrapped)
    if (!sliced) return { scenes: [], rejected: ['整段讀不出 JSON'] }
    try {
      parsed = JSON.parse(sliced)
    } catch {
      return { scenes: [], rejected: ['整段讀不出 JSON'] }
    }
  }

  const rows = arrayIn(parsed)
  if (!rows) return { scenes: [], rejected: ['JSON 裡找不到場次清單'] }

  const out: SceneDraft[] = []
  const rejected: string[] = []

  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      rejected.push(`第 ${index + 1} 筆不是物件`)
      return
    }

    const item = row as Record<string, unknown>
    const content = str(item.content, 20000)

    /*
     * 沒有內容的場次退回整筆。
     *
     * 跟分鏡那邊退回「秒數讀不出來」是同一個判準：這一欄是片長估算的輸入，
     * 而 `estimateSceneSeconds('')` 回 0——一場 0 秒的戲不會報錯，只會讓整集
     * 的預估片長悄悄地短一截，然後「要不要加戲」這個判斷就是照錯的數字做的。
     */
    if (!content) {
      rejected.push(`第 ${index + 1} 場沒有內容`)
      return
    }

    out.push({
      // 標題讀不出來不退回：場次列表上顯示空白標題只是難看，不會讓任何數字
      // 算錯，而內容還在。這跟上面那一條的代價差很多。
      heading: str(item.heading, 200),
      location: str(item.location, 200),
      timeOfDay: str(item.timeOfDay, 40),
      content,
    })
  })

  return { scenes: out, rejected }
}

/**
 * 一句話說出這份產出會變成什麼，給採用之前的預覽用。
 *
 * 面板本來只印候選內容本身，而這個任務的候選內容現在是一段 JSON——
 * 讓人看著一坨 `{"heading":...}` 去按「採用這份」，等於要他相信一個他讀不懂
 * 的東西。`null` 代表這段根本不是場次清單，那就讓面板照舊印原文。
 */
export function describeScenes(text: string): string | null {
  const { scenes, rejected } = parseSceneList(text)
  if (scenes.length === 0) return null

  const chars = scenes.reduce((n, scene) => n + countRichTextChars(scene.content), 0)
  const tail = rejected.length > 0 ? `，另有 ${rejected.length} 筆讀不出來` : ''

  return `${scenes.length} 場、共 ${chars.toLocaleString('en-US')} 字${tail}`
}
