import { TASK_PRIORITIES, type TaskPriorityValue } from '@/lib/constants'

/**
 * 把「任務建議」的輸出讀成可以建立的卡片 (Z153).
 *
 * 這個任務本來回散文，而散文沒有地方可以去：人要自己一條一條重打成卡片。
 * 現在它回 JSON——於是需要一個真的會 parse 它的東西，不然 `STRUCTURED_TASKS`
 * 裡多它一個就只是叫模型「用 JSON 寫散文」。
 *
 * ## 兩種形狀都要收
 *
 * prompt 要的是一個 JSON **陣列**。但 OpenAI 相容端點的
 * `response_format: json_object` 要求頂層是**物件**——七家裡有幾家會據此把
 * 陣列包成 `{"suggestions": [...]}`，有幾家直接回陣列。兩種都收，不然換一
 * 家廠商就整批讀不出來，而錯誤訊息會是「AI 沒有照格式回覆」，看起來像模型
 * 的錯。
 *
 * ## 作品名稱必須對得上
 *
 * `projectTitle` 要能對到一部真的作品，否則這張卡片沒有地方可以建。模型被
 * 告知只能用摘要裡出現過的名稱，但那是請求不是保證——對不上的就退回去，並
 * 且**說出它寫了什麼**，而不是安靜地丟掉。
 */

export type TaskSuggestion = {
  title: string
  projectId: string
  projectTitle: string
  episodeNumber: number | null
  priority: TaskPriorityValue
  reason: string
}

export type ParsedSuggestions = {
  suggestions: TaskSuggestion[]
  /** 讀不出來的，連同原因，給介面照實說。 */
  rejected: string[]
}

/** 去掉 ```json 圍欄，取出第一段看起來像 JSON 的東西。 */
function unwrap(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
  return (fenced?.[1] ?? trimmed).trim()
}

/** 從任意 JSON 值裡找出那個陣列：裸陣列，或物件裡唯一的陣列屬性。 */
function arrayIn(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return null

  const arrays = Object.values(value as Record<string, unknown>).filter(Array.isArray)
  // 剛好一個才算數。兩個陣列的話，猜哪一個是建議清單就是在賭。
  return arrays.length === 1 ? (arrays[0] as unknown[]) : null
}

export function parseTaskSuggestions(
  text: string,
  projects: readonly { id: string; title: string }[]
): ParsedSuggestions {
  const rejected: string[] = []

  let parsed: unknown
  try {
    parsed = JSON.parse(unwrap(text))
  } catch {
    return { suggestions: [], rejected: ['整段讀不出 JSON'] }
  }

  const rows = arrayIn(parsed)
  if (!rows) return { suggestions: [], rejected: ['JSON 裡找不到建議清單'] }

  const byTitle = new Map(projects.map((project) => [project.title.trim(), project]))
  const suggestions: TaskSuggestion[] = []

  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      rejected.push('有一筆不是物件')
      continue
    }

    const item = row as Record<string, unknown>
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    if (!title) {
      rejected.push('有一筆沒有標題')
      continue
    }

    const wanted = typeof item.projectTitle === 'string' ? item.projectTitle.trim() : ''
    /*
     * 只有一部作品的時候不強迫對名稱：模型把《一灶見山河》寫成「一灶見山河」
     * 就整批退回，太苛。兩部以上就必須指明是哪一部——猜錯等於把卡片建到別部
     * 作品去。
     */
    const project =
      byTitle.get(wanted) ?? (projects.length === 1 && !wanted ? projects[0] : undefined)

    if (!project) {
      rejected.push(`「${title}」指到的作品對不上：${wanted || '（沒寫）'}`)
      continue
    }

    const rawPriority = typeof item.priority === 'string' ? item.priority.trim().toUpperCase() : ''
    const priority = (TASK_PRIORITIES as readonly string[]).includes(rawPriority)
      ? (rawPriority as TaskPriorityValue)
      : 'NORMAL'

    const rawEpisode = item.episodeNumber
    const episodeNumber =
      typeof rawEpisode === 'number' && Number.isInteger(rawEpisode) && rawEpisode > 0
        ? rawEpisode
        : null

    suggestions.push({
      title: title.slice(0, 200),
      projectId: project.id,
      projectTitle: project.title,
      episodeNumber,
      priority,
      reason: typeof item.reason === 'string' ? item.reason.trim().slice(0, 500) : '',
    })
  }

  return { suggestions, rejected }
}
