import {
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  type TaskPriorityValue,
  type TaskStatusValue,
} from '@/lib/constants'
import { toPercent } from '@/lib/production'

/**
 * 送進 AI 的「現況摘要」(Z153).
 *
 * 六種任務有 prompt、有定價、進得了佇列，介面上發動不了——而其中三種發動
 * 不了的真正原因不是少一顆按鈕，是**沒有東西餵給它**：
 *
 * - 大綱審視要讀「目前的大綱長什麼樣」，而那散在 120 列裡，集數管理一次只
 *   抓一頁。
 * - 任務建議要讀「目前進度」，而那是看板加上每部作品的集數統計。
 * - 作品企劃要讀「這部作品現在是什麼」。
 *
 * 文字在這裡組，不在瀏覽器裡：**估價跟實際送出走的是同一支**，而這兩個數
 * 字是並排給人看的（Z115 那條）。而且前端手上只有分頁過的資料，用它組出來
 * 的摘要會少掉另外 11 頁。
 *
 * 這一支是**純函式，不碰資料庫**：大綱審視的文字在瀏覽器裡就組得出來（整
 * 份大綱本來就在手上），而把 `db` 拉進用戶端元件會讓 Next 直接編不過去。
 * 要查資料的那半邊在 `digest-server.ts`。
 */

/* -------------------------------------------------------------------------- */
/* 純函式                                                                      */
/* -------------------------------------------------------------------------- */

export type OutlineDigestEpisode = {
  number: number
  title: string
  logline: string
  synopsis: string
}

/**
 * 目前的分集大綱，照集數順序。
 *
 * **一集都沒寫大綱就回空字串**，不回一份只有集號的骨架。那種骨架送出去會
 * 換來一段「你還沒有大綱，我沒辦法審」——花了錢買一句我們本來就知道的話。
 * 回空字串讓介面在按下去之前就說清楚。
 */
export function outlineDigest(
  projectTitle: string,
  rows: readonly OutlineDigestEpisode[]
): string {
  const written = rows.filter((row) => row.logline.trim() || row.synopsis.trim())
  if (written.length === 0) return ''

  const lines: string[] = [
    `《${projectTitle}》目前共 ${rows.length} 集，其中 ${written.length} 集寫了大綱。`,
    '',
  ]

  for (const row of rows) {
    const number = `EP${String(row.number).padStart(3, '0')}`
    const hasOutline = row.logline.trim() || row.synopsis.trim()

    if (!hasOutline) {
      lines.push(`### ${number}（還沒有大綱）`)
      continue
    }

    lines.push(`### ${number}${row.title.trim() ? `　${row.title.trim()}` : ''}`)
    if (row.logline.trim()) lines.push(`一句話：${row.logline.trim()}`)
    if (row.synopsis.trim()) lines.push(`大綱：${row.synopsis.trim()}`)
  }

  return lines.join('\n')
}

export type ProgressDigestProject = {
  title: string
  /** 總集數 / 已完成 / 進行中 / 未開始。 */
  total: number
  done: number
  inProgress: number
  pending: number
  /** 0–1。 */
  overallProgress: number
}

export type ProgressDigestTask = {
  title: string
  status: TaskStatusValue
  priority: TaskPriorityValue
  projectTitle: string
  assigneeName: string | null
  episodeNumber: number | null
  dueDate: Date | null
}

/**
 * 「現在做到哪裡、手上有什麼卡片」，給任務建議讀。
 *
 * 期限用 ISO 日期而不是「三天後」：相對時間在模型眼裡沒有基準點，而這份
 * 文字會被快取、會被重讀。
 */
export function progressDigest(input: {
  projects: readonly ProgressDigestProject[]
  tasks: readonly ProgressDigestTask[]
  /** 過期未完成的張數，看板自己算過了，不要在這裡重算一次。 */
  overdue: number
  /** 今天，由呼叫端給，純函式不去問時鐘。 */
  today: Date
}): string {
  const lines: string[] = [`今天是 ${iso(input.today)}。`, '']

  lines.push('## 製作進度')
  if (input.projects.length === 0) {
    lines.push('（沒有任何作品）')
  } else {
    for (const project of input.projects) {
      lines.push(
        `- 《${project.title}》共 ${project.total} 集：` +
          `已完成 ${project.done}、進行中 ${project.inProgress}、未開始 ${project.pending}` +
          `（整體 ${toPercent(project.overallProgress)}%）`
      )
    }
  }

  lines.push('', '## 任務看板')
  if (input.tasks.length === 0) {
    lines.push('（看板上一張卡片都沒有）')
  } else {
    lines.push(`共 ${input.tasks.length} 件，其中 ${input.overdue} 件過期未完成。`, '')
    for (const task of input.tasks) {
      const bits = [
        `[${TASK_STATUS_LABEL[task.status] ?? task.status}]`,
        `《${task.projectTitle}》`,
      ]
      if (task.episodeNumber !== null) bits.push(`EP${String(task.episodeNumber).padStart(3, '0')}`)
      bits.push(task.title)
      bits.push(`（${TASK_PRIORITY_LABEL[task.priority] ?? task.priority}`)
      bits.push(task.assigneeName ? `／${task.assigneeName}` : '／沒有指派')
      if (task.dueDate) bits.push(`／期限 ${iso(task.dueDate)}`)
      lines.push(`- ${bits.join('')}）`)
    }
  }

  return lines.join('\n')
}

/** 這部作品現在是什麼樣子，給作品企劃讀。 */
export function projectBriefDigest(input: {
  title: string
  logline: string
  synopsis: string
  tags: readonly string[]
  episodeCount: number
  plannedEpisodes: number
  episodesWithOutline: number
}): string {
  const lines: string[] = ['## 這部作品目前的狀態', `名稱：《${input.title}》`]

  /*
   * 「還沒有寫」要寫出來，不要省略那一行。
   *
   * 系統提示要求模型資訊不足時說缺什麼而不是自己補——而「這一行不存在」跟
   * 「這一行是空的」在模型眼裡是兩件事：前者它會以為沒有這個欄位。
   */
  lines.push(input.logline.trim() ? `一句話：${input.logline.trim()}` : '一句話：還沒有寫')
  lines.push(input.synopsis.trim() ? `作品大綱：${input.synopsis.trim()}` : '作品大綱：還沒有寫')

  if (input.tags.length > 0) lines.push(`類型：${input.tags.join('、')}`)

  lines.push(
    `集數：已建立 ${input.episodeCount} 集` +
      (input.plannedEpisodes > 0 ? `，規劃 ${input.plannedEpisodes} 集` : '') +
      `，其中 ${input.episodesWithOutline} 集有大綱`
  )

  return lines.join('\n')
}

function iso(date: Date): string {
  /*
   * 用本地日期，不是 `toISOString()`。
   *
   * 台北是 UTC+8，所以晚上八點之後 `toISOString()` 會回明天——期限整批差
   * 一天，而且只在傍晚之後差。
   */
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
