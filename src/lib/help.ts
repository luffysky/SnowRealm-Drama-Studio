import { IMPORT_TARGETS, type ImportTarget } from '@/lib/import/targets'
import { FILENAME_KEYWORDS } from '@/lib/import/filename'

/**
 * 使用說明裡「要自己打字的那些」(Z189).
 *
 * 欄位表從 `IMPORT_TARGETS` 算出來，所以**說明不會跟程式對不上**。這不是為了
 * 省事：一份過期的說明比沒有說明糟，因為人會照著它做，然後失敗，然後覺得是自
 * 己的錯。
 *
 * 文字本身寫給**沒有碰過這類工具的人**看。規則有三條：
 *
 *  1. 一句話講一件事。
 *  2. 專有名詞第一次出現就用白話解釋，而不是放一個連結。
 *  3. 先講「要做什麼」，再講「為什麼」——而不是反過來。
 */

export type HelpField = {
  label: string
  required: boolean
  hint: string
  sample: string
}

export type HelpSection = {
  key: string
  title: string
  /** 一句話：這一區是裝什麼的。 */
  what: string
  /** 檔名要怎麼取。 */
  filename: string
  /** 要不要指定集數。 */
  needsEpisode: boolean
  fields: HelpField[]
}

export function helpSections(): HelpSection[] {
  return IMPORT_TARGETS.map((target) => ({
    key: target.key,
    title: target.label,
    what: plainWhat(target),
    filename: filenameExample(target),
    needsEpisode: target.scope === 'episode',
    fields: target.fields.map((field) => ({
      label: field.label,
      required: Boolean(field.required),
      hint: field.note ?? plainType(field.type),
      sample: field.sample,
    })),
  }))
}

function filenameExample(target: ImportTarget): string {
  const keyword = FILENAME_KEYWORDS[target.key][0] ?? target.key
  return target.scope === 'episode' ? `${keyword}-EP001.csv` : `${keyword}.csv`
}

/**
 * 型別講成人話。
 *
 * 「`int`，min 1 max 120」對寫程式的人是精確的，對其他人是噪音。這裡講的是
 * 「要填什麼樣的東西」。
 */
function plainType(type: string): string {
  switch (type) {
    case 'int':
      return '填數字（不要小數點）'
    case 'decimal':
      return '填數字，可以有小數點'
    case 'date':
      return '填日期，像 2026-11-20'
    case 'tags':
      return '可以填好幾個，中間用頓號隔開'
    case 'longText':
      return '可以寫很長，也可以換行'
    case 'reference':
      return '填名字，系統會自己對到人'
    case 'vocabulary':
      return '填中文或代號都可以；清單裡沒有的會自動加進去'
    case 'enum':
      return '只能填清單裡有的那幾個'
    default:
      return '填文字'
  }
}

function plainWhat(target: ImportTarget): string {
  switch (target.key) {
    case 'shots':
      return '一集裡每一個鏡頭要拍什麼。一列就是一個鏡頭。'
    case 'characters':
      return '這部戲裡有哪些人，長什麼樣、什麼個性。一列就是一個人。'
    case 'world':
      return '這個故事的世界有哪些設定：地名、物品、規矩。一列就是一條。'
    case 'episodes':
      return '每一集在講什麼。一列就是一集。'
    case 'chapters':
      return '小說的正文，一列就是一章。'
    case 'scenes':
      return '劇本的場次，一列就是一場。'
    case 'tasks':
      return '要做的事情清單。一列就是一件事。'
    case 'expenses':
      return '花了哪些錢。一列就是一筆。'
    default:
      return target.description
  }
}

/* -------------------------------------------------------------------------- */

/** 左邊那排每一個入口在做什麼，一句話。 */
export const RAIL_HELP: { label: string; what: string }[] = [
  { label: '工作室儀表板', what: '最近發生什麼事、哪些東西卡住了，一眼看完。' },
  { label: '作品列表', what: '你有哪幾部戲。點進去才是真正在做事的地方。' },
  { label: '看小說', what: '把寫好的小說當成一本書來讀，也可以聽有聲書。' },
  { label: '影片播放', what: '已經做好的成片放在這裡。' },
  { label: '音樂播放', what: '配樂與音效，可以邊做事邊放。' },
  { label: '訊息', what: '你跟暖寶的對話，可以傳檔案跟語音。' },
  { label: 'AI 助理', what: '問問題、請它幫忙想東西。它看得到這部戲的設定。' },
  { label: '跨作品任務', what: '所有戲的待辦事情放在一起看。' },
  { label: '成本中心', what: '花了多少錢、AI 用掉多少。' },
  { label: '團隊管理', what: '誰是誰、權限是什麼。' },
  { label: 'AI 製片中心', what: 'AI 跑過哪些工作、哪些在等你確認。' },
  { label: '系統設定', what: '金鑰、匯率、編輯器要開哪些功能。' },
]

/** 一部作品裡有哪些分頁。 */
export const TAB_HELP: { label: string; what: string }[] = [
  { label: '總覽', what: '這部戲現在到哪了。' },
  { label: '集數管理', what: '一百二十集的清單，建立集數、看每一集的狀態。' },
  { label: '小說編輯', what: '寫小說。也可以一次匯入好幾集的稿子。' },
  { label: '劇本工坊', what: '把小說改成劇本，分成一場一場。' },
  { label: '世界觀', what: '記下這個故事的設定，免得前後矛盾。' },
  { label: '角色設定', what: '每個角色的樣貌、個性、聲音，還有定妝照。' },
  { label: '分鏡工作台', what: '一集要拍哪些鏡頭、每個幾秒、鏡頭怎麼運動。' },
  { label: '素材資產中心', what: '所有圖片、影片、音樂、配音檔。' },
  { label: '製作流程', what: '這一集走到哪一個階段了。' },
  { label: '審核發布', what: '確認可以出去了沒。' },
  { label: '版本紀錄', what: '誰改了什麼，可以翻回去。' },
]
