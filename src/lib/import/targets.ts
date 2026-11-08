import {
  CHARACTER_TIERS,
  CHARACTER_TIER_LABEL,
  EPISODE_STATUSES,
  EPISODE_STATUS_LABEL,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  SHOT_STATUSES,
  SHOT_STATUS_LABEL,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABEL,
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  WORLD_CATEGORIES,
  WORLD_CATEGORY_LABEL,
} from '@/lib/constants'
import type { VocabularyKind } from '@/lib/vocabulary-view'

/**
 * 每一個「要填表的地方」有哪些欄位 (Z185).
 *
 * 這一份是**三件事的單一來源**：匯入時把欄位對上去、產生給模型看的範例文檔、
 * 以及值的驗證。分開寫三份的話，範例文檔會先過期——而一份過期的範本比沒有範
 * 本糟，因為人會照著它填然後匯入失敗。
 *
 * 不碰 `@/db`，所以用戶端的對應介面 import 得了。
 *
 * ## 別名要寫得多
 *
 * 比對時兩邊都會折繁簡並去掉空白與符號，所以「畫面描述」「畫面」「action」
 * 「動作」只要寫一次大小寫無關的形式。寫得多的代價是幾行字，寫得少的代價是
 * 使用者給了一個合理的欄名而我們認不出來——而那時候他看到的是「這一欄要自己
 * 選」，不是錯誤，所以他會以為是自己的錯。
 */

export type ImportFieldType =
  | 'text'
  | 'longText'
  | 'int'
  | 'decimal'
  | 'date'
  | 'bool'
  | 'tags'
  /** 可以自己加選項的下拉：認不得的值會**新增**一個選項。 */
  | 'vocabulary'
  /** 內建列舉：認不得的值退回預設並回報，不會自己加。 */
  | 'enum'
  /** 依名字對到既有紀錄。 */
  | 'reference'

export type ImportField = {
  key: string
  label: string
  type: ImportFieldType
  aliases: readonly string[]
  required?: boolean
  max?: number
  min?: number
  /** `vocabulary` 用。 */
  vocabulary?: VocabularyKind
  /** `enum` 用。 */
  enumValues?: readonly string[]
  enumLabels?: Record<string, string>
  /** `reference` 用。 */
  reference?: 'character'
  /** 範例文檔裡放的示範值。 */
  sample: string
  /** 範例文檔裡那一欄的說明。 */
  note?: string
}

export type ImportTargetKey =
  | 'shots'
  | 'characters'
  | 'world'
  | 'episodes'
  | 'chapters'
  | 'scenes'
  | 'tasks'
  | 'expenses'

export type ImportTarget = {
  key: ImportTargetKey
  label: string
  /** 一句話說這是什麼，會印在範例文檔最上面。 */
  description: string
  /** 匯入這個需要哪一個上層 id（集數？文件？），介面要先問。 */
  scope: 'project' | 'episode'
  fields: readonly ImportField[]
}

/* -------------------------------------------------------------------------- */

const SHOT_FIELDS: readonly ImportField[] = [
  {
    key: 'sceneCode',
    label: '場次',
    type: 'text',
    max: 20,
    aliases: ['場次', '場號', '場景代號', 'scene', 'sceneCode', 'scene_code', 'slug'],
    sample: 'S01',
  },
  {
    key: 'durationSec',
    label: '秒數',
    type: 'int',
    min: 1,
    max: 120,
    aliases: ['秒數', '秒', '時長', '長度', 'duration', 'durationSec', 'seconds', 'sec'],
    sample: '5',
    note: '1–120。會進總長校驗。',
  },
  {
    key: 'shotSize',
    label: '景別',
    type: 'vocabulary',
    vocabulary: 'shot_size',
    aliases: ['景別', '鏡別', '鏡頭景別', 'shotSize', 'shot_size', 'size', 'framing'],
    sample: '中景',
    note: '大遠景／遠景／全景／中景／近景／特寫／大特寫／插入鏡。不在清單裡的會自動新增。',
  },
  {
    key: 'camera',
    label: '運鏡',
    type: 'vocabulary',
    vocabulary: 'camera_move',
    aliases: ['運鏡', '鏡頭運動', '攝影機', 'camera', 'cameraMove', 'camera_move', 'movement'],
    sample: '固定',
    note: '固定／橫搖／直搖／推軌進／推軌退／跟拍／升降／手持／變焦。不在清單裡的會自動新增。',
  },
  {
    key: 'location',
    label: '地點',
    type: 'text',
    max: 120,
    aliases: ['地點', '場景', '位置', 'location', 'place'],
    sample: '東市街頭',
  },
  {
    key: 'timeOfDay',
    label: '時間',
    type: 'text',
    max: 40,
    aliases: ['時間', '時段', '日夜', 'timeOfDay', 'time_of_day', 'time'],
    sample: '清晨',
  },
  {
    key: 'action',
    label: '畫面描述',
    type: 'longText',
    max: 3000,
    aliases: ['畫面描述', '畫面', '動作', '描述', '內容', 'action', 'description', 'visual'],
    sample: '沈知味推開門，灶上的火還沒熄。',
  },
  {
    key: 'dialogue',
    label: '台詞／旁白',
    type: 'longText',
    max: 3000,
    aliases: ['台詞', '對白', '旁白', '對話', 'dialogue', 'line', 'speech'],
    sample: '熱餅！剛出爐的熱餅！',
  },
  {
    key: 'speaker',
    label: '誰說的',
    type: 'reference',
    reference: 'character',
    aliases: ['誰說的', '說話人', '角色', '說話者', 'speaker', 'character', 'who'],
    sample: '沈知味',
    note: '照角色名對，對不到會留空並回報。',
  },
  {
    key: 'prompt',
    label: '生圖提示詞',
    type: 'longText',
    max: 4000,
    aliases: ['生圖提示詞', '提示詞', '正向提示詞', 'prompt', 'positivePrompt'],
    sample: '古風市集，晨光，蒸汽',
  },
  {
    key: 'negativePrompt',
    label: '負面提示詞',
    type: 'longText',
    max: 2000,
    aliases: ['負面提示詞', '反向提示詞', '負向提示詞', 'negativePrompt', 'negative_prompt', 'negative'],
    sample: '模糊，多手',
  },
  {
    key: 'status',
    label: '狀態',
    type: 'enum',
    enumValues: SHOT_STATUSES,
    enumLabels: SHOT_STATUS_LABEL,
    aliases: ['狀態', '進度', 'status', 'state'],
    sample: '待處理',
    note: '內建選項，認不得的會退回「待處理」並回報。',
  },
  {
    key: 'notes',
    label: '備註',
    type: 'longText',
    max: 2000,
    aliases: ['備註', '註記', '筆記', 'notes', 'note', 'remark'],
    sample: '',
  },
]

const CHARACTER_FIELDS: readonly ImportField[] = [
  {
    key: 'name',
    label: '姓名',
    type: 'text',
    required: true,
    max: 80,
    aliases: ['姓名', '名字', '角色名', '角色', 'name', 'character'],
    sample: '沈知味',
  },
  {
    key: 'alias',
    label: '別名',
    type: 'text',
    max: 120,
    aliases: ['別名', '暱稱', '小名', '稱號', 'alias', 'nickname'],
    sample: '味丫頭',
  },
  {
    key: 'tier',
    label: '重要度',
    type: 'enum',
    enumValues: CHARACTER_TIERS,
    enumLabels: CHARACTER_TIER_LABEL,
    aliases: ['重要度', '層級', '戲分', '角色層級', 'tier', 'importance', 'role'],
    sample: '主角',
  },
  {
    key: 'age',
    label: '年齡',
    type: 'text',
    max: 40,
    aliases: ['年齡', '歲數', 'age'],
    sample: '十九',
  },
  {
    key: 'gender',
    label: '性別',
    type: 'text',
    max: 20,
    aliases: ['性別', 'gender', 'sex'],
    sample: '女',
    note: '男／女／空白。配音挑聲音時會讀它。',
  },
  {
    key: 'appearance',
    label: '外型',
    type: 'longText',
    max: 2000,
    aliases: ['外型', '外貌', '長相', '造型', 'appearance', 'look'],
    sample: '素色布裙，袖口有油煙痕。',
  },
  {
    key: 'personality',
    label: '性格',
    type: 'longText',
    max: 2000,
    aliases: ['性格', '個性', '脾氣', 'personality', 'traits'],
    sample: '嘴硬心軟，算帳極快。',
  },
  {
    key: 'background',
    label: '背景',
    type: 'longText',
    max: 4000,
    aliases: ['背景', '身世', '來歷', '簡介', 'background', 'bio', 'history'],
    sample: '穿越前是餐飲創業者。',
  },
  {
    key: 'growth',
    label: '成長弧線',
    type: 'longText',
    max: 4000,
    aliases: ['成長弧線', '弧線', '成長', '人物弧光', 'growth', 'arc'],
    sample: '從還債到建立商貿網絡。',
  },
  {
    key: 'visualPrompt',
    label: '生圖提示詞',
    type: 'longText',
    max: 4000,
    aliases: ['生圖提示詞', '提示詞', 'visualPrompt', 'prompt'],
    sample: '古風，素衣，廚娘',
  },
  {
    key: 'negativePrompt',
    label: '負面提示詞',
    type: 'longText',
    max: 2000,
    aliases: ['負面提示詞', '反向提示詞', '負向提示詞', 'negativePrompt', 'negative'],
    sample: '濃妝，現代服飾',
  },
  {
    key: 'voiceNote',
    label: '聲音備註',
    type: 'longText',
    max: 2000,
    aliases: ['聲音備註', '配音備註', '音色', 'voiceNote', 'voice'],
    sample: '偏低、語速快。',
  },
]

const WORLD_FIELDS: readonly ImportField[] = [
  {
    key: 'title',
    label: '名稱',
    type: 'text',
    required: true,
    max: 120,
    aliases: ['名稱', '標題', '條目', '詞條', 'title', 'name', 'term'],
    sample: '梅花商契',
  },
  {
    key: 'category',
    label: '分類',
    type: 'enum',
    enumValues: WORLD_CATEGORIES,
    enumLabels: WORLD_CATEGORY_LABEL,
    aliases: ['分類', '類別', '種類', 'category', 'kind', 'type'],
    sample: '物品',
  },
  {
    key: 'summary',
    label: '一句話摘要',
    type: 'text',
    max: 300,
    aliases: ['摘要', '一句話', '簡述', 'summary', 'logline'],
    sample: '沈家與許家的舊約，印在梅花紋的木牌上。',
  },
  {
    key: 'body',
    label: '內容',
    type: 'longText',
    max: 20000,
    aliases: ['內容', '正文', '詳細', '說明', 'body', 'content', 'detail'],
    sample: '三十年前立的契約…',
  },
  {
    key: 'tags',
    label: '標籤',
    type: 'tags',
    aliases: ['標籤', '關鍵字', 'tags', 'tag', 'keywords'],
    sample: '伏筆、信物',
    note: '用頓號、逗號或分號隔開。',
  },
]

const EPISODE_FIELDS: readonly ImportField[] = [
  {
    key: 'number',
    label: '集號',
    type: 'int',
    required: true,
    min: 1,
    max: 9999,
    aliases: ['集號', '集數', '第幾集', 'number', 'episode', 'ep', 'index'],
    sample: '1',
  },
  {
    key: 'title',
    label: '標題',
    type: 'text',
    max: 200,
    aliases: ['標題', '集名', '名稱', 'title', 'name'],
    sample: '三文錢的生意',
  },
  {
    key: 'logline',
    label: '一句話',
    type: 'text',
    max: 300,
    aliases: ['一句話', '梗概', 'logline', 'hook'],
    sample: '身負三兩銀子債務的沈知味，用僅剩的三文錢做出一疊酥香雞皮。',
  },
  {
    key: 'synopsis',
    label: '分集大綱',
    type: 'longText',
    max: 8000,
    aliases: ['大綱', '分集大綱', '劇情', '內容', 'synopsis', 'outline', 'summary'],
    sample: '開場在東市…',
  },
  {
    key: 'targetSec',
    label: '目標片長（秒）',
    type: 'int',
    min: 30,
    max: 3600,
    aliases: ['目標片長', '片長', '秒數', 'targetSec', 'target_sec', 'duration'],
    sample: '150',
  },
  {
    key: 'status',
    label: '狀態',
    type: 'enum',
    enumValues: EPISODE_STATUSES,
    enumLabels: EPISODE_STATUS_LABEL,
    aliases: ['狀態', '進度', 'status', 'state'],
    sample: '規劃中',
  },
]

const CHAPTER_FIELDS: readonly ImportField[] = [
  {
    key: 'title',
    label: '章節標題',
    type: 'text',
    max: 200,
    aliases: ['章節標題', '標題', '章名', 'title', 'chapter', 'heading'],
    sample: '第一章　三文錢',
  },
  {
    key: 'summary',
    label: '章節摘要',
    type: 'text',
    max: 500,
    aliases: ['摘要', '章節摘要', 'summary'],
    sample: '沈知味還清第一筆債。',
  },
  {
    key: 'content',
    label: '正文',
    type: 'longText',
    required: true,
    max: 100000,
    aliases: ['正文', '內容', '本文', 'content', 'body', 'text'],
    sample: '天剛亮，沈知味便被一陣叫賣聲吵醒了。',
    note: '段落之間空一行。',
  },
]

const SCENE_FIELDS: readonly ImportField[] = [
  {
    key: 'code',
    label: '場號',
    type: 'text',
    max: 20,
    aliases: ['場號', '場次', 'code', 'scene', 'sceneCode'],
    sample: 'S01',
  },
  {
    key: 'heading',
    label: '場景標題',
    type: 'text',
    max: 200,
    aliases: ['場景標題', '標題', '場名', 'heading', 'title'],
    sample: '一盆涼水，三兩債',
  },
  {
    key: 'location',
    label: '地點',
    type: 'text',
    max: 120,
    aliases: ['地點', '場景', 'location', 'place'],
    sample: '東市街頭',
  },
  {
    key: 'timeOfDay',
    label: '時間',
    type: 'text',
    max: 40,
    aliases: ['時間', '時段', '日夜', 'timeOfDay', 'time'],
    sample: '清晨',
  },
  {
    key: 'content',
    label: '內容',
    type: 'longText',
    required: true,
    max: 50000,
    aliases: ['內容', '正文', '劇本', 'content', 'body', 'text'],
    sample: '沈知味：（壓低聲音）這餅，今日不賣。',
  },
  {
    key: 'estimatedSec',
    label: '預估秒數',
    type: 'int',
    min: 0,
    max: 3600,
    aliases: ['預估秒數', '秒數', '時長', 'estimatedSec', 'duration'],
    sample: '20',
  },
]

const TASK_FIELDS: readonly ImportField[] = [
  {
    key: 'title',
    label: '標題',
    type: 'text',
    required: true,
    max: 200,
    aliases: ['標題', '任務', '項目', 'title', 'task', 'name'],
    sample: '把 EP001 的分鏡補完',
  },
  {
    key: 'description',
    label: '說明',
    type: 'longText',
    max: 4000,
    aliases: ['說明', '描述', '內容', '備註', 'description', 'detail', 'notes'],
    sample: '缺第 8–12 鏡的畫面描述。',
  },
  {
    key: 'status',
    label: '狀態',
    type: 'enum',
    enumValues: TASK_STATUSES,
    enumLabels: TASK_STATUS_LABEL,
    aliases: ['狀態', '進度', 'status', 'state'],
    sample: '待辦',
  },
  {
    key: 'priority',
    label: '優先序',
    type: 'enum',
    enumValues: TASK_PRIORITIES,
    enumLabels: TASK_PRIORITY_LABEL,
    aliases: ['優先序', '優先', '重要度', 'priority'],
    sample: '一般',
  },
  {
    key: 'dueDate',
    label: '到期日',
    type: 'date',
    aliases: ['到期日', '截止', '期限', 'dueDate', 'due', 'deadline'],
    sample: '2026-11-20',
    note: 'YYYY-MM-DD。',
  },
  {
    key: 'progress',
    label: '完成度',
    type: 'int',
    min: 0,
    max: 100,
    aliases: ['完成度', '進度百分比', 'progress', 'percent'],
    sample: '0',
  },
]

const EXPENSE_FIELDS: readonly ImportField[] = [
  {
    key: 'description',
    label: '項目',
    type: 'text',
    required: true,
    max: 200,
    aliases: ['項目', '品項', '說明', '內容', 'description', 'item', 'name'],
    sample: 'Azure TTS 語音合成',
  },
  {
    key: 'amount',
    label: '金額',
    type: 'decimal',
    required: true,
    min: 0,
    aliases: ['金額', '費用', '價格', '花費', 'amount', 'cost', 'price'],
    sample: '120.50',
    note: '只填數字，幣別填在下一欄。',
  },
  {
    key: 'currency',
    label: '幣別',
    type: 'text',
    max: 8,
    aliases: ['幣別', '貨幣', 'currency'],
    sample: 'TWD',
  },
  {
    key: 'category',
    label: '分類',
    type: 'enum',
    enumValues: EXPENSE_CATEGORIES,
    enumLabels: EXPENSE_CATEGORY_LABEL,
    aliases: ['分類', '類別', 'category', 'kind'],
    sample: '其他',
  },
  {
    key: 'vendor',
    label: '對象／廠商',
    type: 'text',
    max: 120,
    aliases: ['廠商', '對象', '供應商', '收款方', 'vendor', 'supplier', 'payee'],
    sample: 'Microsoft',
  },
  {
    key: 'spentAt',
    label: '日期',
    type: 'date',
    aliases: ['日期', '花費日期', '支出日', 'spentAt', 'date', 'when'],
    sample: '2026-11-08',
  },
  {
    key: 'note',
    label: '備註',
    type: 'longText',
    max: 2000,
    aliases: ['備註', '註記', 'note', 'remark'],
    sample: '',
  },
]

/* -------------------------------------------------------------------------- */

export const IMPORT_TARGETS: readonly ImportTarget[] = [
  {
    key: 'shots',
    label: '分鏡鏡頭',
    description: '一列一個鏡頭。景別與運鏡認不得的值會自動新增成選項。',
    scope: 'episode',
    fields: SHOT_FIELDS,
  },
  {
    key: 'characters',
    label: '角色設定',
    description: '一列一個角色。姓名必填，同名的會跳過不覆蓋。',
    scope: 'project',
    fields: CHARACTER_FIELDS,
  },
  {
    key: 'world',
    label: '世界觀條目',
    description: '一列一個條目。名稱必填。',
    scope: 'project',
    fields: WORLD_FIELDS,
  },
  {
    key: 'episodes',
    label: '集數大綱',
    description: '一列一集。集號必填；已經存在的集會更新大綱，不會重複建立。',
    scope: 'project',
    fields: EPISODE_FIELDS,
  },
  {
    key: 'chapters',
    label: '小說章節',
    description: '一列一章，接在這一集既有章節後面。',
    scope: 'episode',
    fields: CHAPTER_FIELDS,
  },
  {
    key: 'scenes',
    label: '劇本場次',
    description: '一列一場，接在這一集既有場次後面。',
    scope: 'episode',
    fields: SCENE_FIELDS,
  },
  {
    key: 'tasks',
    label: '任務',
    description: '一列一個任務。',
    scope: 'project',
    fields: TASK_FIELDS,
  },
  {
    key: 'expenses',
    label: '支出紀錄',
    description: '一列一筆。金額只填數字，幣別分開一欄——金額不可虛構。',
    scope: 'project',
    fields: EXPENSE_FIELDS,
  },
]

export function importTarget(key: ImportTargetKey): ImportTarget {
  const found = IMPORT_TARGETS.find((target) => target.key === key)
  if (!found) throw new Error(`Unknown import target: ${key}`)
  return found
}

export function isImportTargetKey(value: unknown): value is ImportTargetKey {
  return (
    typeof value === 'string' && IMPORT_TARGETS.some((target) => target.key === value)
  )
}
