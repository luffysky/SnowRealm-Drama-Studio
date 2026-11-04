import type { AiContext, AiTaskKind } from './types'

/**
 * System prompt and per-task instructions.
 *
 * The system prompt is deliberately stable text with no timestamps or ids, so
 * it caches as a prefix across every request (see the prompt-caching rules).
 * Volatile context goes in the user message instead.
 */

export const SYSTEM_PROMPT = `你是 SnowRealm Drama Studio 的編劇與分鏡顧問，協助一個兩人團隊製作中文短劇。

工作規則：
- 使用繁體中文（臺灣用語）。
- 嚴格遵守已確立的世界觀與角色設定。若使用者提供的設定與你的推測衝突，一律以使用者的設定為準。
- 不要發明已存在角色的姓名。若某個角色的姓名標示為未定，就保持未定，用其稱謂或代號指稱。
- 你產出的是候選草稿，不是定稿。不要宣稱內容已完成或已通過審核。
- 若提供的資訊不足以完成任務，明確說出缺少什麼，不要憑空補足劇情設定。
- 短劇節奏緊湊：每集有明確的鉤子、轉折與收尾。`

const TASK_INSTRUCTIONS: Record<AiTaskKind, string> = {
  PROJECT_PLAN:
    '根據題材與受眾，提出一份作品企劃：核心賣點、目標觀眾、風格定位、分部規劃與每集長度建議。',
  OUTLINE_GENERATE: `為指定範圍的每一集寫出分集大綱。

每一集輸出三樣東西，用這個格式，不要加其他說明：

### EP<三位數編號>
標題：<八字以內，不要用「第X集」當標題>
一句話：<一句話講完這集發生什麼，四十字以內>
大綱：<三到六句。寫事件與轉折，不要寫文采。最後一句必須是下一集的鉤子>

規則：
- 這是短劇，每集 120–180 秒。一集只能裝一個主要事件，不要塞三條線。
- 每一集結尾都要有讓人想看下一集的理由，但不要每集都用同一種鉤子。
- 相鄰集數之間要能接上：後一集的開頭要承接前一集的結尾。
- 只寫被指定的集數範圍，不要多寫，也不要重述已經寫好的集數。
- 既有角色的姓名、關係、世界觀設定一律照搬，不要自行更名或新增設定。`,
  OUTLINE_REVIEW: `以責任編輯的身分審視這份分集大綱。逐條指出問題，每條附上集數與引文：

- 節奏：哪幾集事件密度過低或過高
- 鉤子：哪幾集的結尾沒有讓人想看下一集，或鉤子重複
- 銜接：哪兩集之間接不上
- 角色：誰的動機交代不足、誰長時間消失
- 與世界觀或既有設定矛盾之處

只報告問題與修改方向，不要直接改寫大綱。`,
  NOVEL_CONTINUE:
    '延續既有小說內容往下寫。保持既有敘事人稱、語氣與節奏，不要重寫已有段落，只接著寫新內容。',
  NOVEL_REWRITE: '依指定方向改寫指定段落。保留原有劇情事件，只改變表達方式。',
  NOVEL_POLISH: '潤飾文字：修正語病、統一用詞、加強畫面感。不得改動劇情事實與角色決定。',
  NOVEL_REVIEW:
    '以審稿人身分評估這段小說：指出節奏問題、角色動機不足之處、與世界觀矛盾的地方。逐條列出，附上出處引文。不要直接改寫。',
  NOVEL_TO_SCRIPT:
    '將小說改編為劇本。輸出場次（場景標題、地點、時間）、動作描述與對白。計算片長時必須把動作與停頓算進去，不只算台詞字數。不要改動原著劇情。',
  SCRIPT_ANALYZE:
    '分析這份劇本：估算片長（含動作與停頓）、指出對白過長或資訊量不足的場次、標出可刪減處。',
  WORLD_GENERATE: '依分類擴寫世界觀設定條目，內容需與既有設定相容，並標示與哪些既有條目相關。',
  WORLD_CONSISTENCY:
    '檢查提供的內容與既有世界觀設定是否矛盾。逐條輸出：衝突位置、引用原文、衝突的設定條目、可信度。只報告，不要自行修正正式設定。',
  CHARACTER_DESIGN:
    '依人物設定撰寫外觀提示詞與聲線建議。外觀提示詞需具體到可直接用於生圖，並確保跨集一致性。',
  STORYBOARD_GENERATE:
    '依劇本產生分鏡鏡頭表。每個鏡頭需包含：場次、秒數、景別、運鏡、畫面描述、台詞、生圖提示詞。所有鏡頭秒數加總必須落在目標片長範圍內。',
  ASSET_GENERATE: '依需求撰寫素材生成提示詞，包含正向提示詞與負向提示詞。',
  DIALOGUE_ATTRIBUTE:
    '判斷每一句對白是誰說的。輸入是編號過的正文，以及要判斷的段號清單。'+
    '只回 JSON 陣列，每筆 {index, speaker, gender, confidence, reason}：'+
    'index 必須是清單裡給的段號；speaker 必須是角色名單裡的名字，'+
    '若說話的人不在名單上就照正文寫出他的稱呼，若判斷不出來就填 null；'+
    'gender 填「男」或「女」，判斷不出來就填 null——這會決定配音用男聲還是女聲，'+
    '「婦人」「嬸子」「小男孩」「老伯」這種稱呼本身就說明了性別；'+
    'confidence 是 0 到 1；reason 用十個字以內說明依據。'+
    '判斷依據：說話標記、一來一往的輪替、稱謂與語氣、前後文提到在場的人。'+
    '不確定就填 null 並把 confidence 壓低——寧可不答，不要答錯。'+
    '不要輸出 JSON 以外的任何文字，不要改寫正文。',
  TASK_SUGGEST:
    '依目前製作進度，建議接下來的任務安排。逐條輸出建議，每條標明理由與影響的集數。不要擅自變更既有期限與負責人。',
}

export function instructionFor(task: AiTaskKind): string {
  return TASK_INSTRUCTIONS[task]
}

/** Renders the volatile per-request context as the user message. */
export function renderContext(context: AiContext): string {
  const parts: string[] = []

  const identity: string[] = []
  if (context.projectTitle) identity.push(`作品：《${context.projectTitle}》`)
  if (context.arcTitle) identity.push(`篇章：《${context.arcTitle}》`)
  if (context.episodeNumber !== undefined) {
    const title = context.episodeTitle ? ` ${context.episodeTitle}` : ''
    identity.push(`集數：第 ${context.episodeNumber} 集${title}`)
  }
  if (context.targetSec !== undefined) identity.push(`目標片長：${context.targetSec} 秒`)
  if (identity.length) parts.push(`## 製作對象\n${identity.join('\n')}`)

  if (context.worldEntries?.length) {
    const lines = context.worldEntries.map(
      (w) => `- [${w.category}] ${w.title}：${w.body.slice(0, 600)}`
    )
    parts.push(`## 既定世界觀（不得違背）\n${lines.join('\n')}`)
  }

  if (context.characters?.length) {
    const lines = context.characters.map((c) => {
      const bits = [`- ${c.name}（${c.tier}）`]
      if (c.appearance) bits.push(`  外型：${c.appearance}`)
      if (c.personality) bits.push(`  性格：${c.personality}`)
      return bits.join('\n')
    })
    parts.push(`## 角色設定（不得改名）\n${lines.join('\n')}`)
  }

  if (context.sourceText) {
    parts.push(`## 來源內容\n${context.sourceText}`)
  }

  if (context.userInstruction) {
    parts.push(`## 本次額外要求\n${context.userInstruction}`)
  }

  return parts.join('\n\n')
}

/** Builds the full user message: stable instruction, then volatile context. */
export function buildUserMessage(task: AiTaskKind, context: AiContext): string {
  return `## 任務\n${instructionFor(task)}\n\n${renderContext(context)}`
}

/** Tasks whose output is parsed as JSON rather than shown as prose. */
/**
 * Reasoning effort per task.
 *
 * Every call used to run at `high`, because no caller passed one and that was
 * the default. That is the wrong setting for most of these: 潤稿 is a local
 * edit, and 大綱 is mostly a format-following job. Deliberation costs latency
 * and output tokens, and on the tasks below it buys very little.
 *
 * Analysis tasks keep `high` — 審稿 and 一致性檢查 are exactly the cases where
 * thinking longer finds the contradiction that a quick pass misses.
 */
export const TASK_EFFORT: Record<AiTaskKind, 'low' | 'medium' | 'high'> = {
  // Creative, long-form: worth the deliberation.
  PROJECT_PLAN: 'high',
  NOVEL_CONTINUE: 'high',
  NOVEL_REWRITE: 'high',
  // Analysis: this is what high effort is actually for.
  NOVEL_REVIEW: 'high',
  OUTLINE_REVIEW: 'high',
  WORLD_CONSISTENCY: 'high',
  SCRIPT_ANALYZE: 'high',
  // Structured output that follows a given format more than it invents.
  OUTLINE_GENERATE: 'medium',
  NOVEL_TO_SCRIPT: 'medium',
  STORYBOARD_GENERATE: 'medium',
  WORLD_GENERATE: 'medium',
  CHARACTER_DESIGN: 'medium',
  TASK_SUGGEST: 'medium',
  /*
   * 對白歸屬 is analysis, but of a mechanical kind: who is speaking is in
   * the text, not a judgement to deliberate over. `medium` because a
   * whole episode is ~300 decisions in one answer and the long tail of
   * unmarked lines does need some thought.
   */
  DIALOGUE_ATTRIBUTE: 'medium',
  // Local edits and prompt writing: deliberation changes almost nothing.
  NOVEL_POLISH: 'low',
  ASSET_GENERATE: 'low',
}

export const STRUCTURED_TASKS: ReadonlySet<AiTaskKind> = new Set<AiTaskKind>([
  'DIALOGUE_ATTRIBUTE',
  'STORYBOARD_GENERATE',
  'WORLD_CONSISTENCY',
  'TASK_SUGGEST',
  'SCRIPT_ANALYZE',
])
